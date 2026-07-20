import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Excluir conta — Repona",
  description: "Como excluir sua conta e seus dados do Repona.",
};

// E-mail público de contato.
const CONTATO = "netface@gmail.com";

export default function ExcluirContaPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <h1 className="text-3xl font-black tracking-tight">Excluir sua conta</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
        Sua conta do Repona é identificada por um token e guarda os dados que você sincronizou (produtos,
        listas, estoque e histórico). Você pode excluí-la a qualquer momento, sem precisar entrar em contato.
      </p>

      <section className="mt-8">
        <h2 className="mb-2 text-xl font-black tracking-tight">Pelo aplicativo Android</h2>
        <ol className="list-decimal space-y-1 pl-5 text-[15px] leading-relaxed text-ink-soft">
          <li>Abra o Repona e vá até a aba <strong>Casa Repona</strong>.</li>
          <li>Toque em <strong>Excluir conta da nuvem</strong>.</li>
          <li>Confirme. Todos os dados da conta no servidor são apagados imediatamente.</li>
        </ol>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-xl font-black tracking-tight">Pelo app web</h2>
        <ol className="list-decimal space-y-1 pl-5 text-[15px] leading-relaxed text-ink-soft">
          <li>
            Acesse{" "}
            <Link href="/login" className="font-semibold text-primary-strong underline">
              repona.vercel.app
            </Link>{" "}
            e entre com seu token.
          </li>
          <li>Vá em <strong>Perfil</strong> e use <strong>Excluir conta</strong>.</li>
          <li>Confirme a exclusão.</li>
        </ol>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-xl font-black tracking-tight">O que é excluído</h2>
        <p className="text-[15px] leading-relaxed text-ink-soft">
          A exclusão remove <strong>permanentemente</strong> da nuvem: o nome da conta, produtos, listas de
          compras, estoque, histórico de compras, preços e eventos de consumo. A ação afeta todos os
          aparelhos conectados ao mesmo token e <strong>não pode ser desfeita</strong>. Os dados guardados
          localmente no seu aparelho permanecem — para apagá-los, limpe os dados do app nas configurações do
          Android ou desinstale o aplicativo.
        </p>
      </section>

      <div className="mt-10 rounded-2xl border border-line bg-surface px-5 py-4">
        <p className="font-bold">Precisa de ajuda?</p>
        <p className="mt-1 text-sm text-ink-soft">
          A exclusão é feita por você mesmo, pelo app ou pelo app web. Seu token é a única credencial da
          conta (serve para entrar, sincronizar e excluir), então <strong>nunca o envie por e-mail</strong>.
          Se tiver dificuldade, escreva para <strong>{CONTATO}</strong> descrevendo o problema, sem incluir o
          token.
        </p>
      </div>

      <footer className="mt-10 border-t border-line pt-5 text-xs text-ink-faint">
        <Link href="/privacidade" className="font-semibold underline">
          Política de Privacidade
        </Link>
      </footer>
    </main>
  );
}
