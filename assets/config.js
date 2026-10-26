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
  PREMIO_RIFA: "Honda XRE 190 2018 (seminova)",
  CUSTO_PREMIO: 17000,
  LUCRO_ALVO: 40000,

  PIX_KEY: "22992836392",
  PIX_RECEBEDOR: "WELINGTON SANTOS",
  PIX_CIDADE: "CARMO",

  VALOR_NUMERO: 20,
  // Pacotes aplicados automaticamente pela quantidade total selecionada.
  PROMOCOES_COTAS: [
    { quantidade: 10, valor: 170 },
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

  // Segurança: false = comprovante vai para o painel e o responsável confirma após conferir no banco.
  AUTO_CONFIRMAR_COM_COMPROVANTE: false,

  API_URL: "https://script.google.com/macros/s/AKfycbxPV_Y1h0k_ZbJl5XsF2fx3v8vx-r-s9mOk5SiaCAtKu3D9Ix5F-smWYPvVfv2g0OoN/exec"
};
