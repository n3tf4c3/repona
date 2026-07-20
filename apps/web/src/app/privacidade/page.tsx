import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de Privacidade — Repona",
  description: "Como o Repona trata seus dados.",
};

// E-mail público de contato de privacidade.
const CONTATO = "netface@gmail.com";

export default function PrivacidadePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <h1 className="text-3xl font-black tracking-tight">Política de Privacidade</h1>
      <p className="mt-1 text-sm font-semibold text-ink-faint">Última atualização: 20 de julho de 2026</p>

      <div className="mt-6 rounded-2xl bg-primary-soft px-5 py-4 text-sm font-medium text-primary-strong">
        Resumo: o Repona funciona offline e guarda seus dados no aparelho. Se você criar uma conta para
        sincronizar, parte dos dados também é enviada ao nosso servidor por uma conexão segura. Não exigimos
        e-mail nem login social, não exibimos anúncios e não vendemos dados.
      </div>

      <Secao titulo="1. Quem somos">
        O Repona é um aplicativo de organização doméstica que ajuda a gerenciar produtos, listas de compras,
        estoque e histórico de compras. Esta política descreve como tratamos as informações ao usar o app e a
        sincronização opcional na nuvem.
      </Secao>

      <Secao titulo="2. Conta e como você é identificado">
        Não pedimos e-mail, telefone ou login social. Ao criar uma conta, geramos um <strong>token de 8
        caracteres</strong> que é a única credencial — você o usa para acessar a mesma conta no app web e em
        outros aparelhos. O nome da conta (ex.: &quot;Casa do Paulo&quot;) é escolhido por você.
      </Secao>

      <Secao titulo="3. Dados no aparelho">
        Tudo o que você cadastra é guardado primeiro <strong>no seu aparelho</strong>: produtos, listas,
        estoque, histórico e as fotos de produtos que você anexar. As <strong>fotos não saem do
        aparelho</strong> — não são enviadas ao nosso servidor.
      </Secao>

      <Secao titulo="4. Dados enviados à nuvem (ao sincronizar)">
        <p className="mb-3">
          Se você criar uma conta e sincronizar, os seguintes dados são enviados ao nosso servidor por
          HTTPS e ficam vinculados ao token da conta:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Nome da conta;</li>
          <li>Produtos: nome, categoria, marca, código de barras, contagem e status;</li>
          <li>Listas de compras e o estado de cada item;</li>
          <li>Histórico de compras (datas, quantidades) e preços registrados;</li>
          <li>Eventos de consumo do estoque.</li>
        </ul>
      </Secao>

      <Secao titulo="5. Dados que NÃO coletamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Não coletamos e-mail, telefone nem login social;</li>
          <li>Não coletamos localização;</li>
          <li>Não acessamos contatos, mensagens ou outros aplicativos;</li>
          <li>Não usamos rastreadores de publicidade nem vendemos dados a terceiros.</li>
        </ul>
      </Secao>

      <Secao titulo="6. Onde os dados ficam (subprocessadores)">
        <p className="mb-3">
          A sincronização usa serviços de terceiros que processam dados apenas para operar o app:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Vercel</strong> — hospedagem do servidor e da API;</li>
          <li><strong>Neon</strong> — banco de dados (PostgreSQL gerenciado), com conexão criptografada.</li>
        </ul>
      </Secao>

      <Secao titulo="Consulta de código de barras — Open Food Facts">
        Ao escanear o código de barras de um produto, o app consulta a base pública{" "}
        <strong>Open Food Facts</strong> (world.openfoodfacts.org) para sugerir nome, categoria e imagem do
        item. Nessa consulta são enviados apenas o <strong>código de barras</strong> e, por ser uma conexão
        de rede, o <strong>endereço IP</strong> do aparelho — nenhum dado da sua conta, listas ou histórico é
        transmitido. A consulta só acontece quando você usa o leitor de código de barras.
      </Secao>

      <Secao titulo="7. Permissões do aplicativo">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Câmera</strong> (opcional): fotografar produtos e ler códigos de barras;</li>
          <li><strong>Armazenamento/Fotos</strong> (opcional): anexar imagens escolhidas por você.</li>
        </ul>
        <p className="mt-3">
          Negar essas permissões não impede o uso do app — apenas as funções correspondentes ficam
          indisponíveis.
        </p>
      </Secao>

      <Secao titulo="8. Retenção e exclusão de dados">
        <p className="mb-3">
          Os dados na nuvem são mantidos enquanto a conta existir. Você pode excluí-los a qualquer momento:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            No app (aba Conta) ou no app web (Perfil), use <strong>Excluir conta</strong> — isso apaga
            permanentemente todos os dados da conta no servidor. Veja o passo a passo em{" "}
            <Link href="/excluir-conta" className="font-semibold text-primary-strong underline">
              repona.vercel.app/excluir-conta
            </Link>
            .
          </li>
          <li>
            Para apagar os dados locais, limpe os dados do app nas configurações do Android ou desinstale-o.
          </li>
        </ul>
      </Secao>

      <Secao titulo="9. Crianças">
        O Repona é um utilitário doméstico adequado para todos os públicos e não direciona conteúdo a
        crianças nem coleta dados pessoais delas.
      </Secao>

      <Secao titulo="10. Alterações nesta política">
        Se novos recursos mudarem o tratamento de dados, esta política será atualizada antes, com a data acima
        revisada.
      </Secao>

      <div className="mt-10 rounded-2xl border border-line bg-surface px-5 py-4">
        <p className="font-bold">Fale conosco</p>
        <p className="mt-1 text-sm text-ink-soft">
          Dúvidas sobre privacidade? Escreva para <strong>{CONTATO}</strong>.
        </p>
      </div>

      <footer className="mt-10 border-t border-line pt-5 text-xs text-ink-faint">
        © 2026 Repona.
      </footer>
    </main>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-xl font-black tracking-tight">{titulo}</h2>
      <div className="text-[15px] leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}
