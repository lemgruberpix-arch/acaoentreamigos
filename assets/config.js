/*
  CONFIGURAÇÕES PÚBLICAS DA RIFA
  Rifa Honda XRE 190 2018 — Ação Entre Amigos
*/
window.RIFA_CONFIG = {
  NOME_RIFA: "Ação Entre Amigos — Rifa Honda XRE 190 2018",
  TITULO_CURTO: "Rifa Honda XRE 190",
  SUBTITULO: "Ação Entre Amigos",

  RESPONSAVEL_NOME: "Welington Santos",
  WHATSAPP_RESPONSAVEL: "5522992839362",

  DATA_SORTEIO: "31/12 (Loteria Federal)",
  PREMIO_RIFA: "Honda XRE 190 2018 + capacete, ou R$ 20 mil no Pix (escolha do ganhador)",
  CUSTO_PREMIO: 17000,
  LUCRO_ALVO: 40000,

  PIX_KEY: "db150d56-cbb9-4cd5-849c-6b6790ff4495",
  PIX_RECEBEDOR: "ACAO ENTRE AMIGOS",
  PIX_CIDADE: "CARMO",

  VALOR_NUMERO: 18.9,
  // Pacotes aplicados automaticamente pela quantidade total selecionada.
  PROMOCOES_COTAS: [
    { quantidade: 10, valor: 165 },
    { quantidade: 6, valor: 100 },
    { quantidade: 3, valor: 50 }
  ],
  QUANTIDADE_NUMEROS: 10000,
  NUMERO_INICIAL: 0,
  TAMANHO_PAINEL: 100,

  // Sorteio Ao Vivo pelo YouTube (Almir #389)
  YOUTUBE_AO_VIVO: true,
  YOUTUBE_AVISO: "Sorteio transmitido ao vivo pelo canal do YouTube direto no aplicativo! O ganhador será avisado na hora e todos os participantes serão informados.",
  YOUTUBE_CANAL_URL: "https://www.youtube.com/",

  // Programa "Indique e ganhe cotas grátis" (vendedor.html). Os mesmos números valem no servidor (apps-script/codigo.gs):
  // a cada cotasPorBloco cotas PAGAS e confirmadas pelo código do vendedor, ele ganha bonusPorBloco cotas grátis,
  // entregues pelo organizador durante as vendas (não há pagamento em dinheiro).
  INDICACAO: { cotasPorBloco: 100, bonusPorBloco: 5 },

  // Segurança: false = comprovante vai para o painel e o responsável confirma após conferir no banco.
  AUTO_CONFIRMAR_COM_COMPROVANTE: false,

  API_URL: "https://script.google.com/macros/s/AKfycbyp5H5l3waaZIerwBnYf7rXEHK0fhU6nVlTTDJLQ9LHQRrJmcPPNkBf4bVDA5h-f5IN/exec"
};
