# WA Control — sem banco de dados

Projeto Node.js com painel em português, login, QR Code, lista de contatos, mensagem, fila, pausa/parada e histórico em JSON.

## Instalação
1. Instale Node.js 20 ou superior.
2. Extraia a pasta.
3. No terminal, execute `npm install`.
4. Copie `.env.example` para `.env` e troque a senha.
5. Execute `npm start`.
6. Acesse `http://localhost:3000`.

O projeto não usa MySQL, PostgreSQL, MongoDB ou outro banco.
Dados do painel ficam em `data/*.json`; a sessão do WhatsApp fica em `.wwebjs_auth/`.

## Atenção
Use somente com contatos que tenham autorizado receber mensagens. O intervalo mínimo do painel é 15 segundos. Para operação comercial em escala, a WhatsApp Business Platform oficial é a opção apropriada.

Em hospedagem, use armazenamento persistente para não perder a sessão local e o histórico.
