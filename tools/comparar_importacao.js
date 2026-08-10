/* Compara as DUAS normalizações da planilha de mecanização — SEAGRI
 *
 * Existem duas implementações da mesma transformação:
 *   js/importar.js                      lê o .xlsx no navegador (upload do admin)
 *   tools/gerar_dados_mecanizacao.py    lê o mesmo .xlsx e gera js/dados-mecanizacao.js
 *
 * Se elas divergirem, o painel mostra números diferentes conforme a origem dos
 * dados — e as duas versões parecem certas, porque não há erro nenhum: só um
 * total que mudou. Este script transforma essa divergência silenciosa em alarme.
 *
 * Uso (na raiz do projeto):
 *     python tools/gerar_dados_mecanizacao.py     # garante o arquivo atual
 *     node tools/comparar_importacao.js
 *
 * Sem dependências: importar.js usa DecompressionStream, Blob e Response, que
 * o Node traz nativos desde a versão 18. O único apoio é um `window` de faz de
 * conta, porque o arquivo foi escrito para o navegador.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.dirname(__dirname);
const XLSX = path.join(RAIZ, 'mecanizacao26.xlsx');
const IMPORTAR = path.join(RAIZ, 'js', 'importar.js');
const GERADO = path.join(RAIZ, 'js', 'dados-mecanizacao.js');

function morrer(msg) {
  console.error('\n  ERRO: ' + msg + '\n');
  process.exit(2);
}

/* ------------------------------------------------- lado do navegador (JS) */
/** Executa js/importar.js dando a ele o `window` que espera.
    Roda no realm principal de propósito: num contexto isolado (vm) o
    DecompressionStream não interopera com o Blob de fora e a descompactação
    devolve vazio — o arquivo parece não ter a aba "dados". */
function carregarImportar() {
  const codigo = fs.readFileSync(IMPORTAR, 'utf8');
  const janela = {};
  new Function('window', codigo)(janela);
  if (!janela.IMPORTAR) morrer('js/importar.js não exportou window.IMPORTAR.');
  return janela.IMPORTAR;
}

/** O que importar.js espera é um File; aqui basta ter .name e .arrayBuffer(). */
function arquivoFalso(caminho) {
  const buf = fs.readFileSync(caminho);
  return {
    name: path.basename(caminho),
    size: buf.length,
    arrayBuffer: () => Promise.resolve(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  };
}

/* --------------------------------------------------- lado do Python (gerado) */
/** Lê js/dados-mecanizacao.js sem executar nada perigoso: o arquivo é uma única
    atribuição `window.X = {...}`, então basta isolar e parsear o JSON. */
function lerGerado() {
  const txt = fs.readFileSync(GERADO, 'utf8');
  const i = txt.indexOf('{');
  const j = txt.lastIndexOf('}');
  if (i < 0 || j < 0) morrer('js/dados-mecanizacao.js não tem o objeto esperado.');
  try {
    return JSON.parse(txt.slice(i, j + 1));
  } catch (e) {
    morrer('js/dados-mecanizacao.js não é JSON válido: ' + e.message);
  }
}

/* ------------------------------------------------------------- comparação */
/* A ordem das listas maq/impl vem da ordem das tabelas de palavras-chave nos
   dois lados; comparo como conjunto para não acusar diferença onde não há. */
function normalizar(r) {
  const c = Object.assign({}, r);
  c.maq = (r.maq || []).slice().sort();
  c.impl = (r.impl || []).slice().sort();
  c.cult = (r.cult || []).map(x => [x[0], Math.round(x[1] * 100) / 100, x[2]]);
  return c;
}

/** Chave estável para parear os registros: os dois lados ordenam por data, mas
    empates dentro do mesmo dia podem sair em ordens diferentes. */
function chave(r, i) {
  return [r.d, r.dv, r.prod, r.mun, r.pc, r.ha, r.hrs, r.ac].join('|') + '#' + i;
}

function indexar(lista) {
  const m = new Map();
  const vistos = new Map();
  lista.forEach(r => {
    const base = chave(r, 0).split('#')[0];
    const n = vistos.get(base) || 0;
    vistos.set(base, n + 1);
    m.set(base + '#' + n, normalizar(r));
  });
  return m;
}

function diferencas(a, b, limite) {
  const out = [];
  const campos = new Set(Object.keys(a).concat(Object.keys(b)));
  campos.forEach(k => {
    const x = JSON.stringify(a[k]);
    const y = JSON.stringify(b[k]);
    if (x !== y && out.length < limite) out.push('    ' + k + ': js=' + x + '  py=' + y);
  });
  return out;
}

/* ------------------------------------------------------------------- main */
(async function () {
  if (!fs.existsSync(XLSX)) morrer('planilha não encontrada: ' + XLSX);
  if (!fs.existsSync(GERADO)) {
    morrer('js/dados-mecanizacao.js não existe. Rode antes:\n' +
      '         python tools/gerar_dados_mecanizacao.py');
  }

  console.log('Planilha : ' + path.basename(XLSX));
  console.log('Lendo com js/importar.js (caminho do upload no navegador)…');
  const importar = carregarImportar();
  let pacoteJs;
  try {
    pacoteJs = await importar.lerPlanilha(arquivoFalso(XLSX));
  } catch (e) {
    morrer('importar.js não conseguiu ler a planilha: ' + (e && e.message ? e.message : e));
  }

  console.log('Lendo js/dados-mecanizacao.js (caminho do gerador Python)…\n');
  const pacotePy = lerGerado();

  const js = pacoteJs.registros;
  const py = pacotePy.registros;
  let falhas = 0;

  console.log('  registros  js=' + js.length + '  py=' + py.length);
  if (js.length !== py.length) {
    console.log('  ✗ contagem de registros diferente');
    falhas++;
  }

  /* qualidade: os dois lados contam os mesmos problemas na planilha */
  const qj = pacoteJs.meta.qualidade || {};
  const qp = pacotePy.meta.qualidade || {};
  Object.keys(qj).forEach(k => {
    if (!(k in qp)) return;             // o Python tem contadores a mais
    if (qj[k] !== qp[k]) {
      console.log('  ✗ qualidade.' + k + ': js=' + qj[k] + '  py=' + qp[k]);
      falhas++;
    }
  });

  /* registro a registro */
  const iJs = indexar(js);
  const iPy = indexar(py);
  let soJs = 0, soPy = 0, divergentes = 0;
  const amostra = [];

  iJs.forEach((r, k) => {
    if (!iPy.has(k)) { soJs++; return; }
    const d = diferencas(r, iPy.get(k), 6);
    if (d.length) {
      divergentes++;
      if (amostra.length < 3) amostra.push('  registro ' + k.split('#')[0].slice(0, 70) + '\n' + d.join('\n'));
    }
  });
  iPy.forEach((r, k) => { if (!iJs.has(k)) soPy++; });

  if (soJs || soPy) {
    console.log('  ✗ registros sem par: só no js=' + soJs + ', só no py=' + soPy);
    falhas++;
  }
  if (divergentes) {
    console.log('  ✗ registros com campo divergente: ' + divergentes);
    amostra.forEach(a => console.log(a));
    falhas++;
  }

  console.log('');
  if (falhas) {
    console.log('  FALHOU: as duas normalizações não produzem o mesmo resultado.');
    console.log('  Uma planilha enviada pelo admin mostraria números diferentes');
    console.log('  dos do arquivo gerado. Alinhe js/importar.js com');
    console.log('  tools/gerar_dados_mecanizacao.py antes de publicar.\n');
    process.exit(1);
  }
  console.log('  OK: importar.js e gerar_dados_mecanizacao.py concordam');
  console.log('      em ' + js.length + ' registros e em todos os campos.\n');
})();
