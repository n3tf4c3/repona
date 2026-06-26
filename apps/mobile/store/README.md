# 🏪 Kit de Publicação — Google Play

Tudo necessário para publicar o Repona no Google Play Console.

## 👉 Comece por aqui

Abra **`index.html`** no navegador (duplo clique). É um painel com tudo do kit:
baixar cada asset, copiar os textos da listagem (com contador de caracteres) e
um checklist interativo da publicação que salva o progresso no navegador.

## Estrutura

```
store/
├── index.html                       # Painel — abra primeiro: previews, download e checklist
├── assets/                          # Imagens para upload no Play Console
│   ├── icon-512.png                 # Ícone do app (512×512 px)
│   ├── icon-adaptive-foreground.png # Adaptive icon foreground (512×512 px, fundo #2E8B57)
│   ├── feature-1024x500.png         # Gráfico de destaque (1024×500 px)
│   ├── screenshot-1-inicio.png      # Screenshot 1 — Início (1080×1920 px)
│   ├── screenshot-2-lista.png       # Screenshot 2 — Lista de compras (1080×1920 px)
│   ├── screenshot-3-historico.png   # Screenshot 3 — Histórico (1080×1920 px)
│   └── screenshot-4-cadastro.png    # Screenshot 4 — Cadastro (1080×1920 px)
│
├── listing/                         # Textos da listagem (copie e cole no Console)
│   ├── app-name.txt                 # Nome do app (24/30 chars)
│   ├── short-description.txt        # Descrição curta (72/80 chars)
│   ├── full-description.txt         # Descrição completa (< 4000 chars)
│   └── keywords.txt                 # Palavras-chave / tags sugeridas
│
└── README.md                        # Este arquivo
```

## Metadata da Listagem

| Campo                   | Valor                                      |
|-------------------------|--------------------------------------------|
| Categoria               | Estilo de vida (Lifestyle)                 |
| Classificação           | Livre (L) — sem conteúdo sensível          |
| Preço                   | Grátis · Sem anúncios · Sem compras in-app |
| ID do app               | `com.repona.app`                           |

## ⚠️ Antes de publicar

1. **Política de privacidade**: hospedada pelo app web em `https://repona.vercel.app/privacidade` — informe essa URL no Console
2. **Exclusão de conta**: instruções em `https://repona.vercel.app/excluir-conta` — informe no formulário "Data deletion" do Console
3. **App Bundle (.aab)**: o binário assinado precisa ser gerado via EAS Build ou Android Studio — não está incluído neste kit
