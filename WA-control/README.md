# WA Control — Render / sem banco de dados

Painel web em português para conectar uma conta do WhatsApp Web por QR Code e operar mensagens para contatos que autorizaram receber comunicações.

## Importante
- Use somente contatos com opt-in/autorização.
- O projeto não usa banco SQL/NoSQL.
- `storage/` é usado localmente para configuração, histórico e sessão do WhatsApp.
- No Render, monte um Persistent Disk em `/var/data`. O projeto usa `PERSISTENT_ROOT=/var/data`.
- Não envie `.env` para o GitHub.

## Rodar localmente

1. Instale Node.js 22 LTS.
2. Copie `.env.example` para `.env`.
3. Ajuste `PAINEL_USUARIO`, `PAINEL_SENHA` e `SESSION_SECRET`.
4. Execute:

```bash
npm install
npm run check
npm start
```

Abra `http://localhost:10000`.

## Render

### Opção recomendada: Docker

O repositório deve ter o `Dockerfile` na raiz. No Render:

- New → Web Service
- Conecte o GitHub
- Language: Docker
- Dockerfile: `./Dockerfile`
- Health Check Path: `/health`
- Use plano pago com Persistent Disk para manter a sessão do WhatsApp.

Variáveis:

- `NODE_ENV=production`
- `PORT=10000`
- `PERSISTENT_ROOT=/var/data`
- `PAINEL_USUARIO=admin` (troque)
- `PAINEL_SENHA=uma senha forte`
- `SESSION_SECRET` (chave longa e aleatória)

Persistent Disk:

- Mount Path: `/var/data`
- Tamanho inicial: 1 GB

O `render.yaml` já contém essa configuração para quem preferir Blueprint.
