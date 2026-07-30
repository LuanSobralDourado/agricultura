/* Painel da Mecanização — SEAGRI
   Fonte dos dados, na ordem em que é tentada:
     1. data/mecanizacao.json  — publicado pelo admin na aba "Atualizar dados"
     2. localStorage           — carga de teste feita só neste navegador
     3. js/dados-mecanizacao.js— arquivo embutido, gerado por tools/gerar_dados_mecanizacao.py

   Regras do painel:
   - a data de referência de TODOS os filtros, contadores e gráficos é a de
     INSERÇÃO (coluna "Carimbo de data/hora"); a Data da Vistoria só aparece na
     listagem de registros, porque tem digitação errada e serviços de anos antigos;
   - mecanização se mede em hectares; açudagem, em horas de máquina e nº de tanques;
   - todo gráfico aceita mais de um tipo de visualização, coerente com o dado;
   - clicar numa marca filtra e leva para a aba correspondente. */
(function () {
  'use strict';

  var NI = 'Não informado';
  var MEC = 'Mecanização';
  var ACU = 'Açudagem';
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var HASH_ADMIN = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';
  var CHAVE_LOCAL = 'seagri_mecanizacao';

  var TODOS = [], META = {}, FONTE = '', ANOS = [], ANO = '';
  var ORDEM = { tipo: [MEC, ACU], sistema: [] };

  /* -------------------------------------------------------------- utilidades */
  function el(id) { return document.getElementById(id); }
  function unicos(arr) {
    return Array.from(new Set(arr)).filter(function (v) { return v && v !== NI; })
      .sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }
  function soma(arr, f) { return arr.reduce(function (a, r) { return a + (f(r) || 0); }, 0); }
  function contar(arr, f) {
    var m = new Map();
    arr.forEach(function (r) {
      var vs = f(r);
      (Array.isArray(vs) ? vs : [vs]).forEach(function (v) {
        if (v == null || v === '') return;
        m.set(v, (m.get(v) || 0) + 1);
      });
    });
    return m;
  }
  function somarPor(arr, chave, valor) {
    var m = new Map();
    arr.forEach(function (r) {
      var k = chave(r);
      if (k == null || k === '') return;
      m.set(k, (m.get(k) || 0) + (valor(r) || 0));
    });
    return m;
  }
  function distintosPor(arr, chave, valor) {
    var m = new Map();
    arr.forEach(function (r) {
      var k = chave(r), v = valor(r);
      if (k == null || k === '' || v == null || v < 0) return;
      if (!m.has(k)) m.set(k, new Set());
      m.get(k).add(v);
    });
    var out = new Map();
    m.forEach(function (s, k) { out.set(k, s.size); });
    return out;
  }
  function ranking(m, lim, agrupar) {
    var l = Array.from(m, function (e) { return { rot: e[0], val: e[1] }; })
      .filter(function (d) { return d.val > 0; })
      .sort(function (a, b) { return b.val - a.val || a.rot.localeCompare(b.rot, 'pt-BR'); });
    if (lim && l.length > lim) {
      var resto = l.slice(lim - (agrupar ? 1 : 0));
      l = l.slice(0, lim - (agrupar ? 1 : 0));
      if (agrupar) l.push({ rot: 'Outros', val: resto.reduce(function (a, d) { return a + d.val; }, 0) });
    }
    return l;
  }
  function faixas(D, valor, cortes) {
    var m = new Map();
    cortes.forEach(function (c) { m.set(c.rot, 0); });
    D.forEach(function (r) {
      var v = valor(r);
      if (!v) return;
      for (var i = 0; i < cortes.length; i++) {
        if (v <= cortes[i].max) { m.set(cortes[i].rot, m.get(cortes[i].rot) + 1); break; }
      }
    });
    return Array.from(m, function (e) { return { rot: e[0], val: e[1] }; })
      .filter(function (d) { return d.val > 0; });
  }
  function moeda(v) {
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  function dataBR(iso) {
    if (!iso) return '—';
    var p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function mesRot(ym) { return MESES[+ym.slice(5, 7) - 1] + '/' + ym.slice(2, 4); }
  function rotParaMes(rot) {
    var i = MESES.indexOf(String(rot).split('/')[0]);
    return i < 0 ? '' : String(i + 1).padStart(2, '0');
  }
  function produtores(D) {
    return new Set(D.map(function (r) { return r.pid; }).filter(function (p) { return p >= 0; })).size;
  }
  function sha256(txt) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  /* ------------------------------------------------------------------- tema */
  function tema() { return document.documentElement.getAttribute('data-tema') || 'claro'; }
  function pintarBotaoTema() {
    var escuro = tema() === 'escuro';
    el('temaBtn').innerHTML = (escuro
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>') +
      '<span>' + (escuro ? 'Tema claro' : 'Tema escuro') + '</span>';
  }
  function trocarTema() {
    var novo = tema() === 'escuro' ? 'claro' : 'escuro';
    document.documentElement.setAttribute('data-tema', novo);
    try { localStorage.setItem('seagri_tema', novo); } catch (e) { /* modo privado */ }
    pintarBotaoTema();
    render(); // as cores das séries vêm do CSS: precisa redesenhar
  }

  /* ---------------------------------------------------------------- filtros */
  var F = { ano: '', mes: '', pc: '', mun: '', esc: '', cult: '', tec: '' };

  function preencher(id, valores, rotuloTodos) {
    el(id).innerHTML = '<option value="">' + rotuloTodos + '</option>' +
      valores.map(function (v) { return '<option value="' + G.esc(v) + '">' + G.esc(v) + '</option>'; }).join('');
  }

  function popularFiltros() {
    ANOS = unicos(TODOS.map(function (r) { return r.d.slice(0, 4); })).reverse();
    ANO = ANOS[0] || String(new Date().getFullYear());
    // o filtro de ano só aparece quando a base tem mais de um exercício
    el('filtroAno').hidden = ANOS.length <= 1;
    preencher('fAno', ANOS, 'Todos os anos');
    F.ano = ANOS.length <= 1 ? '' : F.ano;

    var meses = Array.from(new Set(TODOS
      .filter(function (r) { return !F.ano || r.d.slice(0, 4) === F.ano; })
      .map(function (r) { return r.d.slice(5, 7); }))).sort();
    el('fMes').innerHTML = '<option value="">Todos os meses</option>' + meses.map(function (m) {
      return '<option value="' + m + '">' + MESES[+m - 1].charAt(0).toUpperCase() + MESES[+m - 1].slice(1) + '</option>';
    }).join('');

    preencher('fPonto', unicos(TODOS.map(function (r) { return r.pc; })), 'Todos os serviços');
    preencher('fMun', unicos(TODOS.map(function (r) { return r.mun; })), 'Todos os municípios');
    preencher('fEsc', unicos(TODOS.map(function (r) { return r.esc; })), 'Todos os escritórios');
    preencher('fTec', unicos(TODOS.map(function (r) { return r.rt; })), 'Todos os técnicos');
    var culturas = [];
    TODOS.forEach(function (r) { r.cult.forEach(function (c) { culturas.push(c[0]); }); });
    preencher('fCult', unicos(culturas), 'Todas as culturas');
    sincronizarFiltros();
  }

  function ligarFiltros() {
    ['fAno|ano', 'fMes|mes', 'fPonto|pc', 'fMun|mun', 'fEsc|esc', 'fCult|cult', 'fTec|tec'].forEach(function (par) {
      var p = par.split('|');
      el(p[0]).addEventListener('change', function () {
        F[p[1]] = this.value;
        pag = 1;
        render();
      });
    });
    el('btnLimpar').addEventListener('click', function () {
      F = { ano: '', mes: '', pc: '', mun: '', esc: '', cult: '', tec: '' };
      sincronizarFiltros();
      el('busca').value = '';
      pag = 1;
      render();
    });
  }

  function sincronizarFiltros() {
    el('fAno').value = F.ano; el('fMes').value = F.mes; el('fPonto').value = F.pc;
    el('fMun').value = F.mun; el('fEsc').value = F.esc; el('fCult').value = F.cult;
    el('fTec').value = F.tec;
  }

  function filtrar() {
    return TODOS.filter(function (r) {
      if (F.ano && r.d.slice(0, 4) !== F.ano) return false;
      if (F.mes && r.d.slice(5, 7) !== F.mes) return false;
      if (F.pc && r.pc !== F.pc) return false;
      if (F.mun && r.mun !== F.mun) return false;
      if (F.esc && r.esc !== F.esc) return false;
      if (F.tec && r.rt !== F.tec) return false;
      if (F.cult && !r.cult.some(function (c) { return c[0] === F.cult; })) return false;
      return true;
    });
  }

  /* ------------------------------- registro de painéis e tipos de gráfico */
  var TIPOS = {}, PAYLOAD = {};
  var ROTULO_TIPO = {
    barras: 'Barras', colunas: 'Colunas', rosca: 'Rosca', pizza: 'Pizza',
    linha: 'Linha', area: 'Área', tabela: 'Tabela'
  };
  var ICONE_TIPO = {
    barras: '<rect x="3" y="5" width="14" height="3.2" rx="1.4"/><rect x="3" y="10.4" width="18" height="3.2" rx="1.4"/><rect x="3" y="15.8" width="9" height="3.2" rx="1.4"/>',
    colunas: '<rect x="4" y="11" width="4" height="9" rx="1.4"/><rect x="10" y="5" width="4" height="15" rx="1.4"/><rect x="16" y="14" width="4" height="6" rx="1.4"/>',
    rosca: '<path d="M12 3a9 9 0 109 9h-4.5a4.5 4.5 0 11-4.5-4.5z"/><path d="M13.4 3.1A9 9 0 0120.9 10.6l-4.4.9a4.5 4.5 0 00-3-3z" opacity=".55"/>',
    pizza: '<path d="M12 12V2.6A9.4 9.4 0 1121.4 12z" opacity=".55"/><path d="M12 12h9.4A9.4 9.4 0 1112 2.6z"/>',
    linha: '<path d="M3 17l5-6 4 3 5-8 4 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    area: '<path d="M3 17l5-6 4 3 5-8 4 5v9H3z" opacity=".5"/><path d="M3 17l5-6 4 3 5-8 4 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    tabela: '<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 9.5h18M9.5 9.5V20" fill="none" stroke="currentColor" stroke-width="1.8"/>'
  };

  function montarControles() {
    document.querySelectorAll('[data-tipos]').forEach(function (div) {
      var id = div.id;
      var tipos = div.getAttribute('data-tipos').split(',');
      var salvo = null;
      try { salvo = localStorage.getItem('seagri_tipo_' + id); } catch (e) { /* modo privado */ }
      TIPOS[id] = tipos.indexOf(salvo) >= 0 ? salvo : tipos[0];

      var cab = div.closest('.painel').querySelector('.painel-cab');
      var acoes = document.createElement('div');
      acoes.className = 'painel-acoes';

      var grupo = document.createElement('div');
      grupo.className = 'tipos';
      grupo.setAttribute('role', 'group');
      grupo.setAttribute('aria-label', 'Tipo de gráfico');
      grupo.innerHTML = tipos.map(function (t) {
        var rot = ROTULO_TIPO[t] || t;
        return '<button type="button" class="tipo-btn' + (t === TIPOS[id] ? ' ativo' : '') +
          '" data-tipo="' + t + '" title="' + rot + '" aria-label="' + rot +
          '" aria-pressed="' + (t === TIPOS[id]) + '">' +
          '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + ICONE_TIPO[t] + '</svg></button>';
      }).join('');
      grupo.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.tipo-btn');
        if (!btn) return;
        var t = btn.getAttribute('data-tipo');
        if (t === TIPOS[id]) return;
        TIPOS[id] = t;
        try { localStorage.setItem('seagri_tipo_' + id, t); } catch (e) { /* modo privado */ }
        grupo.querySelectorAll('.tipo-btn').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('ativo', on);
          b.setAttribute('aria-pressed', on);
        });
        redesenhar(id);
      });
      acoes.appendChild(grupo);

      var ir = div.getAttribute('data-ir');
      if (ir) {
        var link = document.createElement('button');
        link.type = 'button';
        link.className = 'painel-link';
        link.textContent = 'ver detalhes →';
        link.addEventListener('click', function () { abrirAba(ir); });
        acoes.appendChild(link);
      }
      cab.appendChild(acoes);
    });
  }

  function aoClicarDe(div) {
    var campo = div.getAttribute('data-clique');
    if (!campo) return null;
    var ir = div.getAttribute('data-ir');
    return function (rot) {
      if (rot === 'Outros') return;
      if (campo === 'mes') {
        var m = rotParaMes(rot);
        F.mes = (F.mes === m) ? '' : m;
      } else if (campo === 'pc') {
        F.pc = (F.pc === rot) ? '' : rot;
        ir = rot === ACU ? 'acudagem' : 'mecanizacao';
      } else {
        var k = { mun: 'mun', esc: 'esc', cult: 'cult', tec: 'tec' }[campo];
        if (!k) return;
        F[k] = (F[k] === rot) ? '' : rot;
      }
      sincronizarFiltros();
      pag = 1;
      if (ir) abrirAba(ir); else render();
    };
  }

  function pintarCat(id, dados, extra) {
    var div = el(id);
    if (!div) return;
    var opts = Object.assign({
      dec: +(div.getAttribute('data-dec') || 0),
      unidade: div.getAttribute('data-unidade') || '',
      aoClicar: aoClicarDe(div)
    }, extra || {});
    PAYLOAD[id] = { tipo: 'cat', dados: dados, opts: opts };
    G.categorico(TIPOS[id], div, dados, opts);
  }

  function pintarSerie(id, rotulos, series, extra) {
    var div = el(id);
    if (!div) return;
    var opts = Object.assign({
      dec: +(div.getAttribute('data-dec') || 0),
      aoClicar: aoClicarDe(div)
    }, extra || {});
    PAYLOAD[id] = { tipo: 'ser', rotulos: rotulos, series: series, opts: opts };
    G.serie(TIPOS[id], div, rotulos, series, opts);
  }

  function redesenhar(id) {
    var p = PAYLOAD[id];
    if (!p) return;
    if (p.tipo === 'cat') G.categorico(TIPOS[id], el(id), p.dados, p.opts);
    else G.serie(TIPOS[id], el(id), p.rotulos, p.series, p.opts);
  }

  /* ------------------------------------------------------------- stat tiles */
  function tiles(alvo, itens) {
    if (!el(alvo)) return;
    el(alvo).innerHTML = itens.map(function (i) {
      var tag = i.ir ? 'button' : 'div';
      return '<' + tag + ' class="kpi ' + (i.cls || '') + '"' +
        (i.ir ? ' type="button" data-ir="' + i.ir + '" title="Ver detalhes"' : '') + '>' +
        '<div class="kpi-rot">' + i.rot + '</div>' +
        '<div class="kpi-val">' + i.val + (i.un ? '<span class="kpi-un">' + i.un + '</span>' : '') + '</div>' +
        '<div class="kpi-sub">' + (i.sub || '') + '</div></' + tag + '>';
    }).join('');
    el(alvo).querySelectorAll('.kpi[data-ir]').forEach(function (b) {
      b.addEventListener('click', function () { abrirAba(b.getAttribute('data-ir')); });
    });
  }

  /* ------------------------------------------------------- séries temporais */
  /** Eixo do tempo: só os meses que têm registro na seleção — mês sem dado
      não entra no gráfico (evita a série cair para zero sem significado). */
  function chavesMeses(D) {
    return Array.from(new Set(D.map(function (r) { return r.d.slice(0, 7); }))).sort();
  }

  function serieDe(id, D, valor, nomeUnico) {
    var ks = chavesMeses(D);
    if (!ks.length) {
      PAYLOAD[id] = null;
      if (el(id)) G.vazio(el(id));
      return;
    }
    var rot = ks.map(mesRot);
    var series;
    if (nomeUnico) {
      var m = somarPor(D, function (r) { return r.d.slice(0, 7); }, valor);
      series = [{ nome: nomeUnico, slot: nomeUnico === ACU ? 1 : 0, valores: ks.map(function (k) { return m.get(k) || 0; }) }];
    } else {
      var mMec = somarPor(D.filter(function (r) { return r.pc === MEC; }), function (r) { return r.d.slice(0, 7); }, valor);
      var mAcu = somarPor(D.filter(function (r) { return r.pc === ACU; }), function (r) { return r.d.slice(0, 7); }, valor);
      series = [];
      if (!F.pc || F.pc === MEC) series.push({ nome: MEC, slot: 0, valores: ks.map(function (k) { return mMec.get(k) || 0; }) });
      if (!F.pc || F.pc === ACU) series.push({ nome: ACU, slot: 1, valores: ks.map(function (k) { return mAcu.get(k) || 0; }) });
    }
    pintarSerie(id, rot, series);
  }

  /* -------------------------------------------------------- tabelas resumo */
  function tabelaResumo(alvoId, D, chave, rotuloChave) {
    if (!el(alvoId)) return;
    var chaves = Array.from(new Set(D.map(chave))).filter(Boolean);
    var linhas = chaves.map(function (k) {
      var sub = D.filter(function (r) { return chave(r) === k; });
      var mec = sub.filter(function (r) { return r.pc === MEC; });
      return {
        k: k, n: sub.length, mec: mec.length, acu: sub.length - mec.length,
        ha: soma(mec, function (r) { return r.ha; }),
        hrs: soma(sub, function (r) { return r.hrs; }),
        ac: soma(sub, function (r) { return r.ac; }),
        prod: produtores(sub),
        dae: soma(sub, function (r) { return r.dae; })
      };
    }).sort(function (a, b) { return b.n - a.n; });

    if (!linhas.length) return G.vazio(el(alvoId));
    var tot = linhas.reduce(function (a, l) {
      return {
        n: a.n + l.n, mec: a.mec + l.mec, acu: a.acu + l.acu, ha: a.ha + l.ha,
        hrs: a.hrs + l.hrs, ac: a.ac + l.ac, dae: a.dae + l.dae
      };
    }, { n: 0, mec: 0, acu: 0, ha: 0, hrs: 0, ac: 0, dae: 0 });
    var z = function (v, dec) { return v ? G.num(v, dec) : '<span class="nada">—</span>'; };

    el(alvoId).innerHTML = '<div class="tabela-scroll"><table class="dados"><thead><tr>' +
      '<th>' + G.esc(rotuloChave) + '</th><th>Atend.</th><th>Mecaniz.</th><th>Açudagem</th>' +
      '<th>Hectares</th><th>Horas</th><th>Tanques</th><th>Produtores</th><th>DAE</th>' +
      '</tr></thead><tbody>' +
      linhas.map(function (l) {
        return '<tr><td class="forte">' + G.esc(l.k) + '</td>' +
          '<td class="num">' + G.num(l.n) + '</td><td class="num">' + z(l.mec) + '</td>' +
          '<td class="num">' + z(l.acu) + '</td><td class="num">' + z(l.ha, 1) + '</td>' +
          '<td class="num">' + z(l.hrs, 1) + '</td><td class="num">' + z(l.ac) + '</td>' +
          '<td class="num">' + z(l.prod) + '</td><td class="num">' + (l.dae ? moeda(l.dae) : '—') + '</td></tr>';
      }).join('') +
      '<tr><td class="forte">Total</td><td class="num forte">' + G.num(tot.n) + '</td>' +
      '<td class="num forte">' + G.num(tot.mec) + '</td><td class="num forte">' + G.num(tot.acu) + '</td>' +
      '<td class="num forte">' + G.num(tot.ha, 1) + '</td><td class="num forte">' + G.num(tot.hrs, 1) + '</td>' +
      '<td class="num forte">' + G.num(tot.ac) + '</td><td class="num forte">' + G.num(produtores(D)) + '</td>' +
      '<td class="num forte">' + (tot.dae ? moeda(tot.dae) : '—') + '</td></tr></tbody></table></div>';
  }

  function tabelaCulturaMunicipio(D) {
    if (!el('tCultMun')) return;
    var areaTotal = new Map();
    D.forEach(function (r) { r.cult.forEach(function (c) { areaTotal.set(c[0], (areaTotal.get(c[0]) || 0) + c[1]); }); });
    var culturas = ranking(areaTotal, 8).map(function (d) { return d.rot; });
    var mat = new Map(), totMun = new Map();
    D.forEach(function (r) {
      r.cult.forEach(function (c) {
        mat.set(r.mun + '|' + c[0], (mat.get(r.mun + '|' + c[0]) || 0) + c[1]);
        totMun.set(r.mun, (totMun.get(r.mun) || 0) + c[1]);
      });
    });
    var muns = Array.from(totMun.keys()).sort(function (a, b) { return totMun.get(b) - totMun.get(a); });
    if (!culturas.length || !muns.length) return G.vazio(el('tCultMun'));

    el('tCultMun').innerHTML = '<div class="tabela-scroll"><table class="dados"><thead><tr><th>Município</th>' +
      culturas.map(function (c) { return '<th>' + G.esc(c) + '</th>'; }).join('') +
      '<th>Total (ha)</th></tr></thead><tbody>' +
      muns.map(function (m) {
        return '<tr><td class="forte">' + G.esc(m) + '</td>' +
          culturas.map(function (c) {
            var v = mat.get(m + '|' + c) || 0;
            return '<td class="num">' + (v ? G.num(v, 1) : '<span class="nada">—</span>') + '</td>';
          }).join('') +
          '<td class="num forte">' + G.num(totMun.get(m), 1) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ------------------------------------------------------ ficha do produtor */
  function montarSelProd(D) {
    var nomes = Array.from(new Set(D.map(function (r) { return r.prod; }).filter(Boolean)))
      .sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    var atual = el('selProd').value;
    el('selProd').innerHTML = '<option value="">Selecione um produtor (' + G.num(nomes.length) + ' na seleção)</option>' +
      nomes.map(function (n) { return '<option value="' + G.esc(n) + '">' + G.esc(n) + '</option>'; }).join('');
    if (nomes.indexOf(atual) >= 0) el('selProd').value = atual;
    ficha(D);
  }

  function ficha(D) {
    var nome = el('selProd').value;
    if (!nome) return G.vazio(el('fichaProd'), 'Escolha um produtor na lista acima.');
    var R = D.filter(function (r) { return r.prod === nome; });
    if (!R.length) return G.vazio(el('fichaProd'), 'Sem atendimentos para este produtor na seleção atual.');
    var culturas = [];
    R.forEach(function (r) { r.cult.forEach(function (c) { culturas.push(c[0] + ' (' + G.num(c[1], 1) + ' ha)'); }); });
    var maq = Array.from(new Set([].concat.apply([], R.map(function (r) { return r.maq; }))));
    var uni = function (f) { return Array.from(new Set(R.map(f))).filter(Boolean).join(', '); };

    var itens = [
      ['Produtor', G.esc(nome)],
      ['Município', G.esc(uni(function (r) { return r.mun; }))],
      ['Escritório local', G.esc(uni(function (r) { return r.esc; }))],
      ['Propriedade', G.esc(uni(function (r) { return r.propr; }))],
      ['Associação', G.esc(uni(function (r) { return r.assoc; }))],
      ['DAP', G.esc(uni(function (r) { return r.dap; }))],
      ['Atendimentos', G.num(R.length)],
      ['Hectares mecanizados', G.num(soma(R, function (r) { return r.ha; }), 1) + ' ha'],
      ['Horas de máquina', G.num(soma(R, function (r) { return r.hrs; }), 1) + ' h'],
      ['Tanques / açudes', G.num(soma(R, function (r) { return r.ac; }))],
      ['DAE', moeda(soma(R, function (r) { return r.dae; }))],
      ['Culturas', culturas.length ? G.esc(culturas.join(' · ')) : '—'],
      ['Máquinas', maq.length ? G.esc(maq.join(', ')) : '—']
    ];

    el('fichaProd').innerHTML = '<div class="ficha">' + itens.map(function (i) {
      return '<div class="ficha-item"><div class="ficha-rot">' + i[0] + '</div><div class="ficha-val">' +
        (i[1] || '—') + '</div></div>';
    }).join('') + '</div>' +
      '<div class="tabela-scroll"><table class="dados"><thead><tr><th>Inserção</th><th>Vistoria</th><th>Serviço</th>' +
      '<th>Culturas</th><th>Hectares</th><th>Horas</th><th>Tanques</th><th>Técnico</th><th>Formulário</th>' +
      '</tr></thead><tbody>' + R.map(function (r) {
        return '<tr><td class="num">' + dataBR(r.d) + '</td><td class="num">' + dataBR(r.dv) + '</td>' +
          '<td><span class="tag ' + (r.pc === MEC ? 'tag-mec' : 'tag-acu') + '">' + G.esc(r.pc) + '</span></td>' +
          '<td>' + (r.cult.length ? r.cult.map(function (c) { return G.esc(c[0]); }).join(', ') : '—') + '</td>' +
          '<td class="num">' + (r.ha ? G.num(r.ha, 1) : '—') + '</td>' +
          '<td class="num">' + (r.hrs ? G.num(r.hrs, 1) : '—') + '</td>' +
          '<td class="num">' + (r.ac ? G.num(r.ac) : '—') + '</td>' +
          '<td>' + G.esc(r.rt) + '</td>' +
          '<td>' + (r.form ? '<a href="' + G.esc(r.form) + '" target="_blank" rel="noopener">abrir</a>' : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* -------------------------------------------------------------- renderizar */
  function render() {
    if (!TODOS.length) return;
    var D = filtrar();
    var mec = D.filter(function (r) { return r.pc === MEC; });
    var acu = D.filter(function (r) { return r.pc === ACU; });
    var ha = soma(mec, function (r) { return r.ha; });
    var hrs = soma(acu, function (r) { return r.hrs; });
    var nAc = soma(acu, function (r) { return r.ac; });
    var ativos = Object.keys(F).filter(function (k) { return F[k]; }).length;

    var areaCult = new Map(), qtdCult = new Map(), sis = new Map(), haCult = 0, nCult = 0;
    D.forEach(function (r) {
      r.cult.forEach(function (c) {
        areaCult.set(c[0], (areaCult.get(c[0]) || 0) + c[1]);
        qtdCult.set(c[0], (qtdCult.get(c[0]) || 0) + 1);
        if (c[2]) sis.set(c[2], (sis.get(c[2]) || 0) + 1);
        haCult += c[1];
        nCult++;
      });
    });

    el('resumo').innerHTML = '<strong>' + G.num(D.length) + '</strong> de ' + G.num(TODOS.length) +
      ' registros' + (ativos ? ' (' + ativos + ' filtro' + (ativos > 1 ? 's' : '') + ' ativo' + (ativos > 1 ? 's' : '') + ')' : '') +
      (D.length ? ' &middot; inseridos de ' + dataBR(D[0].d) + ' a ' + dataBR(D[D.length - 1].d) : '');

    // ------------------------------------------- visão geral: contadores
    tiles('kpis', [
      { rot: 'Hectares mecanizados', val: G.num(ha, 1), un: 'ha', cls: 'mec', ir: 'mecanizacao', sub: 'campo Total mecanizado' },
      { rot: 'Horas de máquina', val: G.num(hrs, 1), un: 'h', cls: 'acu', ir: 'acudagem', sub: 'serviços de açudagem' },
      { rot: 'Tanques / açudes', val: G.num(nAc), cls: 'acu', ir: 'acudagem', sub: 'construídos ou reformados' },
      { rot: 'Atendimentos', val: G.num(D.length), ir: 'registros', sub: 'vistorias registradas' },
      { rot: 'Vistorias de mecanização', val: G.num(mec.length), cls: 'mec', ir: 'mecanizacao', sub: G.num(produtores(mec)) + ' produtores' },
      { rot: 'Vistorias de açudagem', val: G.num(acu.length), cls: 'acu', ir: 'acudagem', sub: G.num(produtores(acu)) + ' produtores' },
      { rot: 'Produtores atendidos', val: G.num(produtores(D)), ir: 'beneficiario', sub: 'CPFs distintos' },
      { rot: 'Municípios atendidos', val: G.num(new Set(D.map(function (r) { return r.mun; })).size), ir: 'municipio', sub: 'com pelo menos 1 atendimento' },
      { rot: 'Escritórios locais', val: G.num(new Set(D.map(function (r) { return r.esc; })).size), ir: 'escritorio', sub: G.num(new Set(D.map(function (r) { return r.rt; })).size) + ' técnicos atuando' },
      { rot: 'Área das culturas', val: G.num(haCult, 1), un: 'ha', cls: 'mec', ir: 'cultura', sub: G.num(areaCult.size) + ' culturas diferentes' },
      { rot: 'Culturas declaradas', val: G.num(nCult), cls: 'mec', ir: 'cultura', sub: 'até 4 por atendimento' },
      { rot: 'Média por atendimento', val: G.num(mec.length ? ha / mec.length : 0, 1), un: 'ha', cls: 'mec', ir: 'mecanizacao', sub: 'hectares mecanizados' },
      { rot: 'Horas por tanque', val: G.num(nAc ? hrs / nAc : 0, 1), un: 'h', cls: 'acu', ir: 'acudagem', sub: 'produtividade média' },
      { rot: 'Mulheres atendidas', val: G.num(D.filter(function (r) { return r.sexo === 'Feminino'; }).length), ir: 'beneficiario', sub: D.length ? (D.filter(function (r) { return r.sexo === 'Feminino'; }).length / D.length * 100).toFixed(1).replace('.', ',') + '% dos atendimentos' : '' },
      { rot: 'Produtores com DAP', val: G.num(D.filter(function (r) { return r.dap === 'Sim'; }).length), ir: 'beneficiario', sub: 'DAP declarada como válida' },
      { rot: 'DAE arrecadada', val: moeda(soma(D, function (r) { return r.dae; })), ir: 'registros', sub: G.num(D.filter(function (r) { return r.dae > 0; }).length) + ' atendimentos com DAE' }
    ]);

    // ------------------------------------------- visão geral: gráficos
    pintarCat('gMunHa', ranking(somarPor(mec, function (r) { return r.mun; }, function (r) { return r.ha; }), 14));
    pintarCat('gTipo', ranking(contar(D, function (r) { return r.pc; }), 2), { ordem: ORDEM.tipo, unidade: 'atendimentos', multicor: true });
    pintarCat('gCultGeral', ranking(areaCult, 10, true), { cor: 'var(--s4)' });
    pintarCat('gSistemaGeral', ranking(sis, 5, true), { unidade: 'culturas', ordem: ORDEM.sistema, multicor: true });
    serieDe('gSerie', D, function () { return 1; });
    pintarCat('gMunHrs', ranking(somarPor(acu, function (r) { return r.mun; }, function (r) { return r.hrs; }), 12), { cor: 'var(--s2)' });
    pintarCat('gMunAc', ranking(somarPor(acu, function (r) { return r.mun; }, function (r) { return r.ac; }), 12), { cor: 'var(--s2)' });
    pintarCat('gEscGeral', ranking(contar(D, function (r) { return r.esc; }), 12), { cor: 'var(--s3)' });

    // --------------------------------------------------------- mecanização
    tiles('kpisMec', [
      { rot: 'Hectares mecanizados', val: G.num(ha, 1), un: 'ha', cls: 'mec', sub: 'campo Total mecanizado' },
      { rot: 'Vistorias de mecanização', val: G.num(mec.length), cls: 'mec', sub: G.num(produtores(mec)) + ' produtores' },
      { rot: 'Média por atendimento', val: G.num(mec.length ? ha / mec.length : 0, 1), un: 'ha', cls: 'mec', sub: 'hectares' },
      { rot: 'Maior área atendida', val: G.num(mec.reduce(function (a, r) { return Math.max(a, r.ha); }, 0), 1), un: 'ha', cls: 'mec', sub: 'em um único atendimento' },
      { rot: 'DAE arrecadada', val: moeda(soma(mec, function (r) { return r.dae; })), cls: 'mec', sub: G.num(mec.filter(function (r) { return r.dae > 0; }).length) + ' com DAE informada' }
    ]);
    serieDe('gSerieMec', mec, function (r) { return r.ha; }, MEC);
    pintarCat('gMecMun', ranking(somarPor(mec, function (r) { return r.mun; }, function (r) { return r.ha; }), 14));
    pintarCat('gMaq', ranking(contar(mec, function (r) { return r.maq; }), 10), { cor: 'var(--s1)' });
    pintarCat('gImpl', ranking(contar(mec, function (r) { return r.impl; }), 10), { cor: 'var(--s5)' });
    pintarCat('gTrator', ranking(contar(mec, function (r) { return r.tt; }), 4), { unidade: 'atendimentos', multicor: true });
    pintarCat('gFaixa', faixas(mec, function (r) { return r.ha; }, [
      { rot: 'até 2 ha', max: 2 }, { rot: '2 a 5 ha', max: 5 }, { rot: '5 a 10 ha', max: 10 },
      { rot: '10 a 20 ha', max: 20 }, { rot: '20 a 50 ha', max: 50 }, { rot: 'acima de 50', max: Infinity }
    ]), { cor: 'var(--s1)' });

    // ------------------------------------------------------------ açudagem
    tiles('kpisAcu', [
      { rot: 'Horas de máquina', val: G.num(hrs, 1), un: 'h', cls: 'acu', sub: 'escavadeira hidráulica' },
      { rot: 'Tanques / açudes', val: G.num(nAc), cls: 'acu', sub: acu.length ? 'média de ' + G.num(nAc / acu.length, 1) + ' por vistoria' : '—' },
      { rot: 'Horas por tanque', val: G.num(nAc ? hrs / nAc : 0, 1), un: 'h', cls: 'acu', sub: 'produtividade média' },
      { rot: 'Vistorias de açudagem', val: G.num(acu.length), cls: 'acu', sub: G.num(produtores(acu)) + ' produtores' },
      { rot: 'Maior serviço', val: G.num(acu.reduce(function (a, r) { return Math.max(a, r.hrs); }, 0), 1), un: 'h', cls: 'acu', sub: 'em uma única vistoria' }
    ]);
    serieDe('gSerieAcu', acu, function (r) { return r.hrs; }, ACU);
    serieDe('gSerieAc', acu, function (r) { return r.ac; }, ACU);
    pintarCat('gAcuMun', ranking(somarPor(acu, function (r) { return r.mun; }, function (r) { return r.ac; }), 12), { cor: 'var(--s2)' });
    pintarCat('gAcuEsc', ranking(somarPor(acu, function (r) { return r.esc; }, function (r) { return r.hrs; }), 12), { cor: 'var(--s2)' });
    pintarCat('gMaqAcu', ranking(contar(acu, function (r) { return r.maq; }), 8), { cor: 'var(--s2)' });
    pintarCat('gAcuQtd', faixas(acu, function (r) { return r.ac; }, [
      { rot: '1 tanque', max: 1 }, { rot: '2 tanques', max: 2 },
      { rot: '3 tanques', max: 3 }, { rot: '4 ou mais', max: Infinity }
    ]), { cor: 'var(--s2)' });

    // ------------------------------------------------------------- cultura
    var maiorCult = ranking(areaCult, 1)[0];
    tiles('kpisCult', [
      { rot: 'Hectares em culturas', val: G.num(haCult, 1), un: 'ha', cls: 'mec', sub: G.num(nCult) + ' culturas declaradas' },
      { rot: 'Culturas diferentes', val: G.num(areaCult.size), cls: 'mec', sub: 'no período selecionado' },
      { rot: 'Cultura com mais área', val: maiorCult ? G.esc(maiorCult.rot) : '—', cls: 'mec', sub: maiorCult ? G.num(maiorCult.val, 1) + ' ha' : '' },
      { rot: 'Atendimentos com cultura', val: G.num(D.filter(function (r) { return r.cult.length; }).length), cls: 'mec', sub: 'de ' + G.num(D.length) + ' no total' }
    ]);
    var rkCult = ranking(areaCult, 14);
    rkCult.forEach(function (d) { d.sub = '(' + G.num(qtdCult.get(d.rot) || 0) + ' reg.)'; });
    pintarCat('gCult', rkCult, { cor: 'var(--s4)' });
    pintarCat('gCultQtd', ranking(qtdCult, 14), { cor: 'var(--s4)' });
    pintarCat('gSistema', ranking(sis, 5, true), { unidade: 'culturas', ordem: ORDEM.sistema, multicor: true });
    pintarCat('gCultPorReg', faixas(mec, function (r) { return r.cult.length; }, [
      { rot: '1 cultura', max: 1 }, { rot: '2 culturas', max: 2 },
      { rot: '3 culturas', max: 3 }, { rot: '4 culturas', max: 4 }
    ]), { cor: 'var(--s4)' });
    tabelaCulturaMunicipio(D);

    // ----------------------------------------------------------- município
    tiles('kpisMun', [
      { rot: 'Municípios atendidos', val: G.num(new Set(D.map(function (r) { return r.mun; })).size), sub: 'na seleção atual' },
      { rot: 'Hectares mecanizados', val: G.num(ha, 1), un: 'ha', cls: 'mec', sub: 'total da seleção' },
      { rot: 'Horas de máquina', val: G.num(hrs, 1), un: 'h', cls: 'acu', sub: 'total da seleção' },
      { rot: 'Tanques / açudes', val: G.num(nAc), cls: 'acu', sub: 'total da seleção' },
      { rot: 'Produtores atendidos', val: G.num(produtores(D)), sub: 'CPFs distintos' }
    ]);
    pintarCat('gMunHa2', ranking(somarPor(mec, function (r) { return r.mun; }, function (r) { return r.ha; }), 14));
    pintarCat('gMunHrs2', ranking(somarPor(acu, function (r) { return r.mun; }, function (r) { return r.hrs; }), 14), { cor: 'var(--s2)' });
    pintarCat('gMunAc2', ranking(somarPor(acu, function (r) { return r.mun; }, function (r) { return r.ac; }), 14), { cor: 'var(--s2)' });
    pintarCat('gMunProd', ranking(distintosPor(D, function (r) { return r.mun; }, function (r) { return r.pid; }), 14), { cor: 'var(--s3)' });
    tabelaResumo('tMun', D, function (r) { return r.mun; }, 'Município');

    // --------------------------------------------------- escritório local
    pintarCat('gEsc', ranking(contar(D, function (r) { return r.esc; }), 14), { cor: 'var(--s3)' });
    pintarCat('gEscHa', ranking(somarPor(mec, function (r) { return r.esc; }, function (r) { return r.ha; }), 14));
    pintarCat('gEscHrs', ranking(somarPor(acu, function (r) { return r.esc; }, function (r) { return r.hrs; }), 14), { cor: 'var(--s2)' });
    pintarCat('gTec', ranking(contar(D, function (r) { return r.rt; }), 14), { cor: 'var(--s3)' });
    tabelaResumo('tEsc', D, function (r) { return r.esc; }, 'Escritório local');

    // -------------------------------------------------------- beneficiário
    pintarCat('gSexo', ranking(contar(D, function (r) { return r.sexo; }), 5), { unidade: 'atendimentos', ordem: ['Masculino', 'Feminino', NI], multicor: true });
    pintarCat('gDap', ranking(contar(D, function (r) { return r.dap; }), 5), { unidade: 'atendimentos', ordem: ['Sim', 'Não', 'Vencida', NI], multicor: true });
    pintarCat('gCivil', ranking(contar(D, function (r) { return r.ec; }), 8), { cor: 'var(--s3)' });
    pintarCat('gAssoc', ranking(contar(D.filter(function (r) { return r.assoc !== NI; }), function (r) { return r.assoc; }), 10), { cor: 'var(--s5)' });
    montarSelProd(D);

    // ----------------------------------------------------------- registros
    tabela(D);
    nota();
    fonteDados();
  }

  /* ------------------------------------------------------------------ tabela */
  var pag = 1, POR_PAG = 25;

  function tabela(D) {
    var q = el('busca').value.trim().toLowerCase();
    var L = !q ? D : D.filter(function (r) {
      return (r.prod + ' ' + r.mun + ' ' + r.esc + ' ' + r.propr + ' ' + r.rt + ' ' + r.loc + ' ' +
        r.cult.map(function (c) { return c[0]; }).join(' ')).toLowerCase().indexOf(q) >= 0;
    });
    if ((pag - 1) * POR_PAG >= L.length) pag = 1;
    var pagina = L.slice((pag - 1) * POR_PAG, (pag - 1) * POR_PAG + POR_PAG);
    var nada = '<span class="nada">—</span>';

    el('tCorpo').innerHTML = pagina.length ? pagina.map(function (r) {
      var cult = r.cult.length
        ? r.cult.map(function (c) { return G.esc(c[0]) + ' <small>(' + G.num(c[1], 1) + ' ha)</small>'; }).join('<br>')
        : nada;
      var vistoriaOutroAno = r.dv && r.dv.slice(0, 4) !== r.d.slice(0, 4);
      return '<tr>' +
        '<td class="num">' + dataBR(r.d) + '</td>' +
        '<td class="num' + (vistoriaOutroAno ? ' alerta' : '') + '" ' +
        (vistoriaOutroAno ? 'title="Vistoria de outro ano — os indicadores usam a data de inserção"' : '') + '>' +
        dataBR(r.dv) + '</td>' +
        '<td><span class="tag ' + (r.pc === MEC ? 'tag-mec' : 'tag-acu') + '">' + G.esc(r.pc) + '</span></td>' +
        '<td class="forte">' + G.esc(r.prod || '—') + '<br><small class="fraco">' + G.esc(r.propr) + '</small></td>' +
        '<td>' + G.esc(r.mun) + '<br><small class="fraco">' + G.esc(r.esc) + '</small></td>' +
        '<td>' + cult + '</td>' +
        '<td class="num">' + (r.ha ? G.num(r.ha, 1) : nada) + '</td>' +
        '<td class="num">' + (r.hrs ? G.num(r.hrs, 1) : nada) + '</td>' +
        '<td class="num">' + (r.ac ? G.num(r.ac) : nada) + '</td>' +
        '<td>' + (r.maq.length ? G.esc(r.maq.join(', ')) : nada) + '<br><small class="fraco">' +
        (r.impl.length ? G.esc(r.impl.join(', ')) : '') + '</small></td>' +
        '<td class="num">' + (r.dae ? moeda(r.dae) : nada) + '</td>' +
        '<td>' + (r.form ? '<a href="' + G.esc(r.form) + '" target="_blank" rel="noopener">abrir</a>' : nada) + '</td>' +
        '</tr>';
    }).join('') : '<tr><td colspan="12" class="vazio">Nenhum registro encontrado.</td></tr>';

    var paginas = Math.max(1, Math.ceil(L.length / POR_PAG));
    el('pagInfo').textContent = L.length ? 'Página ' + pag + ' de ' + paginas + ' — ' + G.num(L.length) + ' registro(s)' : '';
    el('pagAnt').disabled = pag <= 1;
    el('pagProx').disabled = pag >= paginas;
  }

  /* ------------------------------------------------------- nota de qualidade */
  function nota() {
    var q = META.qualidade || {};
    var fora = TODOS.filter(function (r) { return r.dv && r.dv.slice(0, 4) !== r.d.slice(0, 4); }).length;
    el('nota').innerHTML =
      '<b>Sobre os dados.</b> Fonte: <code>' + G.esc(META.arquivo || 'planilha de mecanização') +
      '</code>, aba <code>' + G.esc(META.aba || 'dados') + '</code> — ' + G.num(TODOS.length) +
      ' registros, importados em ' + G.esc(META.gerado_em || '—') + '.' +
      ' <b>Todas as datas do painel são a de inserção</b> (coluna <em>Carimbo de data/hora</em>).' +
      '<ul>' +
      '<li>' + G.num(fora) + ' registros foram lançados num ano e têm <em>Data da Vistoria</em> de outro ' +
      '(aparecem destacados na coluna Vistoria da listagem);</li>' +
      '<li>' + G.num(q.cpf_invalido || 0) + ' registros sem CPF válido — não entram na contagem de produtores distintos;</li>' +
      '<li>' + G.num(q.sem_geo || 0) + ' registros sem coordenada geográfica utilizável, por isso não há mapa;</li>' +
      '<li>' + G.num(q.sem_formulario || 0) + ' registros sem link do formulário digitalizado.</li>' +
      '</ul>' +
      'Campos livres (nome do trator, tipo de implemento) foram padronizados por palavra-chave, ' +
      'e um mesmo atendimento pode contar em mais de uma categoria de máquina ou implemento.';
  }

  /* -------------------------------------------------------------------- abas */
  var botoes = [];
  function abrirAba(nome) {
    botoes.forEach(function (b) {
      var ativa = b.getAttribute('data-aba') === nome;
      b.classList.toggle('ativa', ativa);
      if (ativa && b.scrollIntoView) b.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
    document.querySelectorAll('.aba-conteudo').forEach(function (c) {
      c.classList.toggle('ativa', c.getAttribute('data-aba') === nome);
    });
    if (location.hash.slice(1) !== nome) history.replaceState(null, '', '#' + nome);
    render();
    window.scrollTo(0, 0);
  }

  /* ============================== ADMIN: senha e carga de planilha ========= */
  function ehAdmin() {
    try { return sessionStorage.getItem('seagri_admin') === '1'; } catch (e) { return false; }
  }
  function aplicarAdmin() {
    var on = ehAdmin();
    el('abaAdmin').hidden = !on;
    el('adminBtn').innerHTML = on ? '&#9989;<span>Admin (sair)</span>' : '&#128274;<span>Admin</span>';
    if (!on && document.querySelector('.aba.ativa') &&
      document.querySelector('.aba.ativa').getAttribute('data-aba') === 'admin') abrirAba('geral');
    if (window._sidebarRefreshAdmin) window._sidebarRefreshAdmin();
  }
  function abrirModal() {
    el('admSenha').value = '';
    el('admErro').textContent = '';
    el('admOverlay').classList.add('show');
    setTimeout(function () { el('admSenha').focus(); }, 60);
  }
  function entrar() {
    sha256(el('admSenha').value).then(function (h) {
      if (h !== HASH_ADMIN) {
        el('admErro').textContent = 'Senha incorreta. Tente novamente.';
        el('admSenha').value = '';
        el('admSenha').focus();
        return;
      }
      try { sessionStorage.setItem('seagri_admin', '1'); } catch (e) { /* modo privado */ }
      el('admOverlay').classList.remove('show');
      aplicarAdmin();
      abrirAba('admin');
    });
  }

  function aviso(alvo, classe, html) {
    el(alvo).innerHTML = '<p class="aviso ' + classe + '">' + html + '</p>';
  }

  function fonteDados() {
    if (!el('upFonte')) return;
    var rotulos = {
      servidor: 'Publicado no servidor (<code>data/mecanizacao.json</code>)',
      navegador: 'Carga local, só neste navegador',
      embutido: 'Arquivo embutido (<code>js/dados-mecanizacao.js</code>)'
    };
    var itens = [
      ['Origem', rotulos[FONTE] || FONTE],
      ['Planilha', G.esc(META.arquivo || '—')],
      ['Importada em', G.esc(META.gerado_em || '—')],
      ['Publicada em', G.esc(META.publicado_em || '—')],
      ['Registros', G.num(TODOS.length)],
      ['Período de inserção', TODOS.length ? dataBR(TODOS[0].d) + ' a ' + dataBR(TODOS[TODOS.length - 1].d) : '—']
    ];
    el('upFonte').innerHTML = '<div class="ficha">' + itens.map(function (i) {
      return '<div class="ficha-item"><div class="ficha-rot">' + i[0] + '</div>' +
        '<div class="ficha-val">' + i[1] + '</div></div>';
    }).join('') + '</div>' +
      (FONTE === 'navegador'
        ? '<p class="aviso">Estes dados estão apenas neste navegador. Use <b>Publicar para todos</b> na aba de atualização para valer para todo mundo, ou limpe com o botão abaixo.<br><button class="btn" id="upLimparLocal" type="button" style="margin-top:8px">Descartar carga local</button></p>'
        : '');
    var limpar = el('upLimparLocal');
    if (limpar) {
      limpar.addEventListener('click', function () {
        try { localStorage.removeItem(CHAVE_LOCAL); } catch (e) { /* nada */ }
        location.reload();
      });
    }
  }

  var pendente = null; // pacote lido da planilha, aguardando confirmação

  function lerArquivo(arquivo) {
    if (!arquivo) return;
    if (!/\.xlsx$/i.test(arquivo.name)) {
      return aviso('upStatus', 'erro', 'Envie um arquivo <b>.xlsx</b>. Se a planilha estiver em .xls ou no Google Sheets, exporte como .xlsx primeiro.');
    }
    pendente = null;
    el('upAcoes').hidden = true;
    el('upResumo').innerHTML = '';
    aviso('upStatus', 'carregando', 'Lendo <b>' + G.esc(arquivo.name) + '</b> (' +
      (arquivo.size / 1048576).toFixed(1).replace('.', ',') + ' MB)…');

    IMPORTAR.lerPlanilha(arquivo).then(function (pacote) {
      pendente = pacote;
      var antes = TODOS.length, depois = pacote.registros.length;
      var novos = depois - antes;
      var q = pacote.meta.qualidade || {};
      aviso('upStatus', 'ok', 'Planilha lida com sucesso: <b>' + G.num(depois) +
        ' registros</b> na aba <code>' + IMPORTAR.aba + '</code>.');
      el('upResumo').innerHTML = '<div class="ficha">' + [
        ['Registros no painel agora', G.num(antes)],
        ['Registros na planilha enviada', G.num(depois)],
        ['Diferença', (novos > 0 ? '+' : '') + G.num(novos) + (novos < 0 ? ' (a planilha tem menos linhas!)' : '')],
        ['Produtores distintos', G.num(pacote.meta.produtores || 0)],
        ['Período de inserção', dataBR(pacote.meta.periodo[0]) + ' a ' + dataBR(pacote.meta.periodo[1])],
        ['Sem CPF válido', G.num(q.cpf_invalido || 0)]
      ].map(function (i) {
        return '<div class="ficha-item"><div class="ficha-rot">' + i[0] + '</div>' +
          '<div class="ficha-val">' + i[1] + '</div></div>';
      }).join('') + '</div>' +
        (novos < 0 ? '<p class="aviso erro">A planilha enviada tem <b>menos</b> linhas que os dados atuais. ' +
          'Confirme se é o arquivo certo antes de publicar.</p>' : '');
      el('upAcoes').hidden = false;
    }).catch(function (e) {
      aviso('upStatus', 'erro', '<b>Não foi possível ler a planilha.</b><br>' + G.esc(e && e.message ? e.message : String(e)));
    });
  }

  function usarPacote(pacote, fonte) {
    TODOS = pacote.registros.slice().sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    META = pacote.meta || {};
    FONTE = fonte;
    var m = new Map();
    TODOS.forEach(function (r) {
      r.cult.forEach(function (c) { if (c[2]) m.set(c[2], (m.get(c[2]) || 0) + 1); });
    });
    ORDEM.sistema = Array.from(m.keys()).sort(function (a, b) { return m.get(b) - m.get(a); });
    popularFiltros();
  }

  function publicar() {
    if (!pendente) return;
    var senha = prompt('Confirme a senha de administrador para publicar:');
    if (senha == null) return;
    aviso('upStatus', 'carregando', 'Publicando no servidor…');
    fetch('../salvar_mecanizacao.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha: senha, dados: pendente })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, corpo: j }; });
    }).then(function (res) {
      if (!res.ok || !res.corpo.ok) throw new Error(res.corpo.erro || 'Erro no servidor.');
      aviso('upStatus', 'ok', 'Publicado: <b>' + G.num(res.corpo.registros) +
        ' registros</b> em ' + G.esc(res.corpo.publicado_em) + '. Todo mundo já vê os dados novos.');
      try { localStorage.removeItem(CHAVE_LOCAL); } catch (e) { /* nada */ }
      usarPacote(pendente, 'servidor');
      pendente = null;
      el('upAcoes').hidden = true;
      render();
    }).catch(function (e) {
      aviso('upStatus', 'erro', '<b>Falha ao publicar.</b> ' + G.esc(e.message) +
        '<br>Se o servidor não tem PHP (ex.: GitHub Pages), use <b>Usar só neste navegador</b> ' +
        'ou rode <code>python tools/gerar_dados_mecanizacao.py</code> e publique o arquivo gerado.');
    });
  }

  function usarSoLocal() {
    if (!pendente) return;
    try {
      localStorage.setItem(CHAVE_LOCAL, JSON.stringify(pendente));
    } catch (e) {
      return aviso('upStatus', 'erro', 'Não foi possível guardar no navegador (espaço insuficiente): ' + G.esc(e.message));
    }
    aviso('upStatus', 'ok', 'Dados carregados <b>só neste navegador</b>. O servidor não foi alterado.');
    usarPacote(pendente, 'navegador');
    pendente = null;
    el('upAcoes').hidden = true;
    render();
  }

  function ligarAdmin() {
    el('adminBtn').addEventListener('click', function () {
      if (ehAdmin()) {
        try { sessionStorage.removeItem('seagri_admin'); } catch (e) { /* nada */ }
        aplicarAdmin();
        return;
      }
      abrirModal();
    });
    el('admOk').addEventListener('click', entrar);
    el('admCancelar').addEventListener('click', function () { el('admOverlay').classList.remove('show'); });
    el('admSenha').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') entrar();
      if (e.key === 'Escape') el('admOverlay').classList.remove('show');
    });
    el('admOverlay').addEventListener('click', function (e) {
      if (e.target === el('admOverlay')) el('admOverlay').classList.remove('show');
    });

    var zona = el('upZona');
    zona.addEventListener('click', function () { el('upArquivo').click(); });
    el('upArquivo').addEventListener('change', function () { lerArquivo(this.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add('sobre'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.remove('sobre'); });
    });
    zona.addEventListener('drop', function (e) {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) lerArquivo(e.dataTransfer.files[0]);
    });
    el('upAplicar').addEventListener('click', publicar);
    el('upSoLocal').addEventListener('click', usarSoLocal);
    el('upCancelar').addEventListener('click', function () {
      pendente = null;
      el('upAcoes').hidden = true;
      el('upResumo').innerHTML = '';
      el('upArquivo').value = '';
      aviso('upStatus', '', 'Carga cancelada. Nada foi alterado.');
    });
  }

  /* -------------------------------------------------------- carregar dados */
  function carregarDados() {
    return fetch('../data/mecanizacao.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('sem arquivo publicado');
        return r.json();
      })
      .then(function (j) {
        if (!j || !Array.isArray(j.registros) || !j.registros.length) throw new Error('vazio');
        return { pacote: j, fonte: 'servidor' };
      })
      .catch(function () {
        try {
          var s = localStorage.getItem(CHAVE_LOCAL);
          if (s) {
            var j = JSON.parse(s);
            if (j && Array.isArray(j.registros) && j.registros.length) return { pacote: j, fonte: 'navegador' };
          }
        } catch (e) { /* modo privado ou JSON corrompido */ }
        return { pacote: window.DADOS_MECANIZACAO, fonte: 'embutido' };
      });
  }

  /* -------------------------------------------------------------------- init */
  botoes = Array.prototype.slice.call(document.querySelectorAll('.aba'));
  botoes.forEach(function (b) {
    b.addEventListener('click', function () { abrirAba(b.getAttribute('data-aba')); });
  });
  pintarBotaoTema();
  el('temaBtn').addEventListener('click', trocarTema);
  montarControles();
  ligarFiltros();
  ligarAdmin();
  aplicarAdmin();
  el('busca').addEventListener('input', function () { pag = 1; tabela(filtrar()); });
  el('pagAnt').addEventListener('click', function () { pag--; tabela(filtrar()); });
  el('pagProx').addEventListener('click', function () { pag++; tabela(filtrar()); });
  el('selProd').addEventListener('change', function () { ficha(filtrar()); });
  window.addEventListener('resize', (function () {
    var t;
    return function () { clearTimeout(t); t = setTimeout(render, 220); };
  })());

  carregarDados().then(function (res) {
    if (!res.pacote || !res.pacote.registros) {
      document.querySelector('.wrap').insertAdjacentHTML('afterbegin',
        '<p class="aviso erro">Não foi possível carregar os dados de mecanização.</p>');
      return;
    }
    usarPacote(res.pacote, res.fonte);
    var inicial = location.hash.slice(1);
    var valida = botoes.some(function (b) {
      return b.getAttribute('data-aba') === inicial && !b.hidden;
    });
    abrirAba(valida ? inicial : 'geral');
  });
})();
