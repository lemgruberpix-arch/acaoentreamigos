# Ação Entre Amigos

Cartela pública para escolha de números, pagamento via Pix, envio de comprovante e confirmação manual pelo responsável.

## Endereços

- Repositório: <https://github.com/lemgruberpix-arch/acaoentreamigos>
- Site público: <https://acaoentreamigos.pages.dev/>
- Painel administrativo: arquivo local `admin.html`, deliberadamente ignorado pelo Git e publicado separadamente somente após proteção do backend.

## Rodar localmente

Na pasta do projeto:

```bash
python -m http.server 8080
```

Abra <http://127.0.0.1:8080/>. Para revisar as artes, use `cartaz.html` e `canvas-instagram.html`.

## Testes locais

```bash
node tests/check_ui_contracts.js
node tests/check_codigo_admin.js
node tests/check_poster_contracts.js
```

As verificações do painel administrativo e do pacote de produção permanecem somente no ambiente local privado, junto dos arquivos que elas validam.

## Segurança e publicação

- Nunca grave `ADMIN_TOKEN`, senhas ou credenciais no repositório.
- O arquivo público `assets/config.js` contém somente configuração necessária ao navegador.
- `admin.html` e `publicar/` permanecem fora do GitHub público.
- O Apps Script de produção deve exigir `ADMIN_TOKEN`; a confirmação automática de pagamento permanece desligada.
- Antes de publicar, rode todas as verificações e confira `git ls-files` para garantir que nenhum arquivo privado entrou no commit.
