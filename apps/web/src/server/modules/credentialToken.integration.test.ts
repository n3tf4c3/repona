import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool, type PoolClient } from "pg";
import {
  CREDENTIAL_TOKEN_LOCK_KEY,
  CREDENTIAL_TOKEN_LOCK_NAMESPACE,
} from "./credentialTokenLock";
import {
  CREATE_ACCOUNT_WITH_RECEIPT_SQL,
  ROTATE_ACCOUNT_TOKEN_SQL,
} from "./credentialTokenSql";
import {
  assertRecoverableTokenOperation,
  IDEMPOTENCY_CONFLICT,
} from "./accountOperation";

const databaseUrl = process.env.TEST_DATABASE_URL;

async function lockCredentialNamespace(client: PoolClient): Promise<void> {
  await client.query("select pg_advisory_xact_lock($1::int, $2::int)", [
    CREDENTIAL_TOKEN_LOCK_NAMESPACE,
    CREDENTIAL_TOKEN_LOCK_KEY,
  ]);
}

async function assertStillPending(promise: Promise<unknown>): Promise<void> {
  const state = await Promise.race([
    promise.then(() => "settled", () => "settled"),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 100)),
  ]);
  assert.equal(state, "pending");
}

test(
  "Postgres: reserva current/alias é serial, atômica e converge dois devices",
  { skip: !databaseUrl, timeout: 30_000 },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 6 });
    const casaIds: number[] = [];
    const operationIds: string[] = [];
    const token = (label: string) => `test:#71:${label}:${randomUUID()}`;
    const insertCasa = async (inviteCodeEnc: string) => {
      const created = await pool.query<{ id: number }>(
        "insert into casas (name, invite_code_enc) values ('Integração #71', $1) returning id",
        [inviteCodeEnc]
      );
      casaIds.push(created.rows[0].id);
      return created.rows[0].id;
    };

    try {
      // O writer segura o advisory e só então publica um alias que colide com
      // o candidato do CREATE. O waiter iniciou antes, mas o statement 2 em
      // READ COMMITTED recebe snapshot novo depois do wait e rejeita a reserva.
      const aliasOwner = await insertCasa(token("alias-owner"));
      const candidateAfterWait = token("candidate-after-wait");
      const createOperation = randomUUID();
      operationIds.push(createOperation);
      const writer = await pool.connect();
      const waiter = await pool.connect();
      await writer.query("begin isolation level read committed");
      await lockCredentialNamespace(writer);
      const waitingCreate = (async () => {
        try {
          await waiter.query("begin isolation level read committed");
          await lockCredentialNamespace(waiter);
          const result = await waiter.query(CREATE_ACCOUNT_WITH_RECEIPT_SQL, [
            "Não deve criar",
            candidateAfterWait,
            createOperation,
            "request-hash-create",
            "verifier-hash-create",
          ]);
          await waiter.query("commit");
          return result;
        } catch (error) {
          await waiter.query("rollback");
          throw error;
        } finally {
          waiter.release();
        }
      })();
      await assertStillPending(waitingCreate);
      await writer.query(
        `insert into casa_token_migration_aliases (token_enc, casa_id, valid_until)
         values ($1, $2, '2027-04-01T00:00:00.000Z')`,
        [candidateAfterWait, aliasOwner]
      );
      await writer.query("commit");
      writer.release();
      assert.equal((await waitingCreate).rowCount, 0);
      assert.equal(
        Number((await pool.query(
          "select count(*) from casas where invite_code_enc = $1",
          [candidateAfterWait]
        )).rows[0].count),
        0
      );

      // Resposta perdida depois do COMMIT: o recibo v2 conserva exatamente o
      // token vencedor. Uma repetição crua da mutação não deixa uma segunda
      // casa, e um verifier incorreto não autoriza ler o resultado do dump.
      const responseLostOperation = randomUUID();
      const responseLostToken = token("response-lost-current");
      const responseLostOtherToken = token("response-lost-other");
      const responseLostRequestHash = "r".repeat(43);
      const responseLostVerifierHash = "v".repeat(43);
      operationIds.push(responseLostOperation);
      const responseLostClient = await pool.connect();
      await responseLostClient.query("begin isolation level read committed");
      await lockCredentialNamespace(responseLostClient);
      const responseLostCreate = await responseLostClient.query<{ id: number }>(
        CREATE_ACCOUNT_WITH_RECEIPT_SQL,
        [
          "Resposta perdida",
          responseLostToken,
          responseLostOperation,
          responseLostRequestHash,
          responseLostVerifierHash,
        ]
      );
      await responseLostClient.query("commit");
      responseLostClient.release();
      assert.equal(responseLostCreate.rowCount, 1);
      casaIds.push(responseLostCreate.rows[0].id);

      const storedAfterResponseLost = (await pool.query<{
        operationVersion: number;
        operationType: string;
        requestHash: string;
        resultTokenEnc: string | null;
        operationVerifierHash: string | null;
      }>(
        `select operation_version as "operationVersion",
                operation_type as "operationType",
                request_hash as "requestHash",
                result_token_enc as "resultTokenEnc",
                operation_verifier_hash as "operationVerifierHash"
           from account_operations where operation_id = $1`,
        [responseLostOperation]
      )).rows[0];
      assert.doesNotThrow(() =>
        assertRecoverableTokenOperation(
          storedAfterResponseLost,
          "create",
          responseLostVerifierHash,
          responseLostRequestHash
        )
      );
      assert.throws(
        () =>
          assertRecoverableTokenOperation(
            storedAfterResponseLost,
            "create",
            "x".repeat(43),
            responseLostRequestHash
          ),
        new RegExp(IDEMPOTENCY_CONFLICT)
      );

      const rawReplayClient = await pool.connect();
      await rawReplayClient.query("begin isolation level read committed");
      await lockCredentialNamespace(rawReplayClient);
      await assert.rejects(
        rawReplayClient.query(CREATE_ACCOUNT_WITH_RECEIPT_SQL, [
          "Resposta perdida",
          responseLostOtherToken,
          responseLostOperation,
          responseLostRequestHash,
          responseLostVerifierHash,
        ]),
        (error: unknown) =>
          typeof error === "object" && error !== null &&
          "code" in error && (error as { code?: string }).code === "23505"
      );
      await rawReplayClient.query("rollback");
      rawReplayClient.release();
      assert.equal(
        Number((await pool.query(
          "select count(*) from casas where invite_code_enc = $1",
          [responseLostOtherToken]
        )).rows[0].count),
        0
      );

      // Colisão do candidato não pode apagar alias, trocar current, incrementar
      // versão nem criar recibo parcial.
      const targetCurrent = token("target-current");
      const targetPriorAlias = token("target-prior-alias");
      const collidingCurrent = token("colliding-current");
      const targetCasa = await insertCasa(targetCurrent);
      await insertCasa(collidingCurrent);
      await pool.query(
        `insert into casa_token_migration_aliases (token_enc, casa_id, valid_until)
         values ($1, $2, '2027-04-01T00:00:00.000Z')`,
        [targetPriorAlias, targetCasa]
      );
      const collisionOperation = randomUUID();
      operationIds.push(collisionOperation);
      const collisionClient = await pool.connect();
      await collisionClient.query("begin isolation level read committed");
      await lockCredentialNamespace(collisionClient);
      const collision = await collisionClient.query(ROTATE_ACCOUNT_TOKEN_SQL, [
        targetCurrent,
        collidingCurrent,
        collisionOperation,
        "request-collision",
        "2027-04-01T00:00:00.000Z",
        "rotate",
        "2026-08-01T00:00:00.000Z",
        "verifier-collision",
      ]);
      await collisionClient.query("commit");
      collisionClient.release();
      assert.equal(collision.rowCount, 0);
      const unchanged = await pool.query<{
        inviteCodeEnc: string;
        credentialVersion: number;
      }>(
        `select invite_code_enc as "inviteCodeEnc",
                credential_version as "credentialVersion"
           from casas where id = $1`,
        [targetCasa]
      );
      assert.equal(unchanged.rows[0].inviteCodeEnc, targetCurrent);
      assert.equal(unchanged.rows[0].credentialVersion, 0);
      assert.equal(
        Number((await pool.query(
          "select count(*) from casa_token_migration_aliases where token_enc = $1 and casa_id = $2",
          [targetPriorAlias, targetCasa]
        )).rows[0].count),
        1
      );
      assert.equal(
        Number((await pool.query(
          "select count(*) from account_operations where operation_id = $1",
          [collisionOperation]
        )).rows[0].count),
        0
      );

      // Device 1 troca o legado; device 2 chega com o alias e recebe o current
      // já promovido, sem uma segunda rotação/credentialVersion.
      const legacy = token("legacy");
      const current = token("current");
      const ignoredCandidate = token("ignored-candidate");
      const migratedCasa = await insertCasa(legacy);
      const device1 = randomUUID();
      const device2 = randomUUID();
      operationIds.push(device1, device2);
      const first = await pool.connect();
      await first.query("begin isolation level read committed");
      await lockCredentialNamespace(first);
      assert.equal((await first.query(ROTATE_ACCOUNT_TOKEN_SQL, [
        legacy,
        current,
        device1,
        "request-device-1",
        "2027-04-01T00:00:00.000Z",
        "migrate",
        "2026-08-01T00:00:00.000Z",
        "verifier-device-1",
      ])).rowCount, 1);
      const second = await pool.connect();
      const device2Migration = (async () => {
        try {
          await second.query("begin isolation level read committed");
          await lockCredentialNamespace(second);
          const migrated = await second.query(ROTATE_ACCOUNT_TOKEN_SQL, [
            legacy,
            ignoredCandidate,
            device2,
            "request-device-2",
            "2027-04-01T00:00:00.000Z",
            "migrate",
            "2026-08-02T00:00:00.000Z",
            "verifier-device-2",
          ]);
          await second.query("commit");
          return migrated;
        } catch (error) {
          await second.query("rollback");
          throw error;
        } finally {
          second.release();
        }
      })();
      await assertStillPending(device2Migration);
      await first.query("commit");
      first.release();
      assert.equal((await device2Migration).rowCount, 1);
      const converged = await pool.query<{
        inviteCodeEnc: string;
        credentialVersion: number;
      }>(
        `select invite_code_enc as "inviteCodeEnc",
                credential_version as "credentialVersion"
           from casas where id = $1`,
        [migratedCasa]
      );
      assert.deepEqual(converged.rows[0], {
        inviteCodeEnc: current,
        credentialVersion: 1,
      });
      const receipts = await pool.query<{ resultTokenEnc: string }>(
        `select result_token_enc as "resultTokenEnc" from account_operations
          where operation_id = any($1::uuid[]) order by operation_id`,
        [[device1, device2]]
      );
      assert.deepEqual(receipts.rows.map((row) => row.resultTokenEnc), [current, current]);

      // A comparação é estrita: no instante exato do hard end o alias não é
      // mais prova válida e nenhuma versão/recibo adicional é persistida.
      const hardEndOperation = randomUUID();
      operationIds.push(hardEndOperation);
      const afterHardEnd = await pool.connect();
      await afterHardEnd.query("begin isolation level read committed");
      await lockCredentialNamespace(afterHardEnd);
      const hardEndAttempt = await afterHardEnd.query(ROTATE_ACCOUNT_TOKEN_SQL, [
        legacy,
        token("after-hard-end"),
        hardEndOperation,
        "request-after-hard-end",
        "2027-04-01T00:00:00.000Z",
        "migrate",
        "2027-04-01T00:00:00.000Z",
        "verifier-after-hard-end",
      ]);
      await afterHardEnd.query("commit");
      afterHardEnd.release();
      assert.equal(hardEndAttempt.rowCount, 0);
      assert.equal(
        Number((await pool.query(
          "select count(*) from account_operations where operation_id = $1",
          [hardEndOperation]
        )).rows[0].count),
        0
      );
      assert.deepEqual((await pool.query<{
        inviteCodeEnc: string;
        credentialVersion: number;
      }>(
        `select invite_code_enc as "inviteCodeEnc",
                credential_version as "credentialVersion"
           from casas where id = $1`,
        [migratedCasa]
      )).rows[0], {
        inviteCodeEnc: current,
        credentialVersion: 1,
      });

      // Upgrade db:push: v1/NULL continua representável, porém v2 token-returning
      // sem verifier é rejeitado pelo CHECK. A aplicação recusa replay v1.
      const legacyReceipt = randomUUID();
      operationIds.push(legacyReceipt);
      await pool.query(
        `insert into account_operations
          (operation_id, operation_version, operation_type, request_hash, result_token_enc)
         values ($1, 1, 'create', 'legacy-request', $2)`,
        [legacyReceipt, current]
      );
      const persistedV1 = (await pool.query<{
        operationVersion: number;
        operationType: string;
        requestHash: string;
        resultTokenEnc: string | null;
        operationVerifierHash: string | null;
      }>(
        `select operation_version as "operationVersion",
                operation_type as "operationType",
                request_hash as "requestHash",
                result_token_enc as "resultTokenEnc",
                operation_verifier_hash as "operationVerifierHash"
           from account_operations where operation_id = $1`,
        [legacyReceipt]
      )).rows[0];
      assert.throws(
        () =>
          assertRecoverableTokenOperation(
            persistedV1,
            "create",
            "v".repeat(43),
            "legacy-request"
          ),
        new RegExp(IDEMPOTENCY_CONFLICT)
      );
      await assert.rejects(
        pool.query(
          `insert into account_operations
            (operation_id, operation_version, operation_type, request_hash, result_token_enc)
           values ($1, 2, 'create', 'invalid-v2', $2)`,
          [randomUUID(), current]
        ),
        (error: unknown) =>
          typeof error === "object" && error !== null &&
          "code" in error && (error as { code?: string }).code === "23514"
      );
    } finally {
      if (operationIds.length) {
        await pool.query("delete from account_operations where operation_id = any($1::uuid[])", [
          operationIds,
        ]).catch(() => {});
      }
      if (casaIds.length) {
        await pool.query("delete from casa_token_migration_aliases where casa_id = any($1::int[])", [
          casaIds,
        ]).catch(() => {});
        await pool.query("delete from casas where id = any($1::int[])", [casaIds]).catch(() => {});
      }
      await pool.end();
    }
  }
);
