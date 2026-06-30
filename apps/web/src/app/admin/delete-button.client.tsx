"use client";

// Botão de exclusão com confirmação nativa. A Server Action vem do servidor
// (passada como prop); o submit é abortado se o usuário não confirmar.
export function DeleteCasaButton({
  id,
  name,
  action,
}: {
  id: number;
  name: string;
  action: (formData: FormData) => void;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          !confirm(
            `Excluir a casa "${name}" (#${id}) e TODOS os seus dados (produtos, estoque e histórico)? Não há como desfazer.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-danger transition hover:bg-coral-soft"
      >
        Excluir
      </button>
    </form>
  );
}
