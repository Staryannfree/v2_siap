/* Content Script — SIAP Frequência */

// 1. SIREN: DETECÇÃO DE ERRO CRÍTICO (KILL SWITCH AGRESSIVO)
(function siapSirenKillSwitch() {
  const pageText = document.documentElement.innerHTML || "";
  const titleText = (document.title || "");
  
  const isServerError = 
    titleText.includes("Component Dre.Repositorio") || 
    titleText.includes("Server Error") ||
    titleText.includes("Exception") ||
    pageText.includes("Server Error in '/' Application") || 
    pageText.includes("ComponentRegistrationException");

  if (isServerError) {
    console.error("🚨 [SIAP TURBO] Erro 500 detectado via HTML/Título. Abortando execução.");
    // Tenta avisar o painel uma última vez via função segura
    safeSendMessage({ action: "PORTAL_SERVER_ERROR" });
    // Para a execução do script IMEDIATAMENTE. Nada abaixo desta linha será executado.
    throw new Error("SIAP_PORTAL_SERVER_ERROR_DETECTED");
  }
})();

/** 
 * Envia mensagens para a extensão de forma segura, evitando erros de "Context Invalidated" 
 * ou "TypeError" quando o SIAP sai do ar ou a extensão é atualizada.
 */
function safeSendMessage(message) {
  try {
    if (typeof chrome !== 'undefined' && chrome && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(message, function() {
        // Silencia erro comum de contexto invalidado no callback
        if (chrome.runtime.lastError) { /* ignore */ }
      });
    }
  } catch (e) {
    /* ignore (ex: Extension context invalidated) */
  }
}

/** Envia console da aba SIAP para o painel React (relay no background.js). */
(function siapInstallContentLiveLogBridge() {
  try {
    if (typeof window !== 'undefined' && window.__SIAP_CONTENT_LIVE_LOG__) return;
    if (typeof window !== 'undefined') window.__SIAP_CONTENT_LIVE_LOG__ = true;

    var SIAP_LIVE_LOG = 'SIAP_LIVE_LOG';

    function formatArg(a) {
      if (a === null) return 'null';
      if (a === undefined) return 'undefined';
      if (typeof a === 'string') return a;
      if (typeof a === 'number' || typeof a === 'boolean') return String(a);
      if (typeof a === 'bigint') return String(a);
      if (a instanceof Error) return a.stack || a.message || String(a);
      try {
        return JSON.stringify(a);
      } catch (e) {
        return String(a);
      }
    }

    function send(level, args) {
      try {
        var text = Array.prototype.slice.call(args).map(formatArg).join(' ');
        safeSendMessage({
          type: SIAP_LIVE_LOG,
          level: level,
          text: text,
          ts: Date.now(),
          href: typeof location !== 'undefined' ? location.href : '',
        });
      } catch (e) {
        /* ignore */
      }
    }

    ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
      var orig = console[level].bind(console);
      console[level] = function () {
        send(level, arguments);
        return orig.apply(console, arguments);
      };
    });

    window.addEventListener('error', function (ev) {
      send('error', [ev.message, ev.filename, ev.lineno, ev.error]);
    });
    window.addEventListener('unhandledrejection', function (ev) {
      var r = ev.reason;
      send('error', ['UnhandledRejection:', r instanceof Error ? r.stack || r.message : String(r)]);
    });
  } catch (e) {
    /* ignore */
  }
})();

console.log("SIAP: [DEBUG] Script de conteúdo carregado. Versão 1.5.8 (MUDAR_MES: PostBack manual CSP-safe, sem inject)");

const STORAGE_KEY = "SIAP_TASK_QUEUE";
const QUEUE_KEY = 'siap_click_queue';
let isProcessing = false; 
let totalItemsInQueue = 0;
let siapPrmReady = false;

// Intercepta requisições AJAX do ASP.NET via polling no próprio content-script.
// NÃO usa createElement('script') — imune à CSP do SIAP.
(function hookAjaxWatcher() {
  var _ajaxPollAttempts = 0;
  var _ajaxPoller = setInterval(function() {
    _ajaxPollAttempts++;
    // Sys pode ficar disponível após vários UpdatePanel cycles
    var Sys = window.Sys;
    if (Sys && Sys.WebForms && Sys.WebForms.PageRequestManager) {
      clearInterval(_ajaxPoller);
      try {
        var prm = Sys.WebForms.PageRequestManager.getInstance();
        prm.add_beginRequest(function() {
          document.body && document.body.setAttribute('data-siap-ajax', 'true');
        });
        prm.add_endRequest(function() {
          document.body && document.body.setAttribute('data-siap-ajax', 'false');
        });
        siapPrmReady = true; // PRM encontrado e hooks registrados — fila liberada.
        console.log('SIAP: [PRM] PageRequestManager pronto. Fila de cliques liberada.');
      } catch(e) {
        // Sys presente mas sem PRM ativo (página sem UpdatePanel) — libera mesmo assim.
        siapPrmReady = true;
        console.warn('SIAP: [PRM] PRM indisponível (sem UpdatePanel?) — fila liberada.');
      }
    }
    if (_ajaxPollAttempts >= 5) {
      // NOTA: Content scripts rodam em Isolated World e NÃO enxergam window.Sys
      // (variável JS da página ASP.NET). O PRM nunca será detectável via este método.
      // Após 1s (~5 polls × 200ms), libera a fila imediatamente para não atrasar.
      clearInterval(_ajaxPoller);
      if (!siapPrmReady) {
        siapPrmReady = true;
        console.log('SIAP: [PRM] Isolated World — window.Sys inacessível. Fila liberada após 1s.');
      }
    }
  }, 200);
})();

/**
 * Postback ASP.NET sem <script> inline — imune à CSP (script-src).
 * Replica __doPostBack preenchendo __EVENTTARGET / __EVENTARGUMENT e submetendo o form (CSP não bloqueia form.submit).
 */
function safeDoPostBack(eventTarget, eventArgument) {
  console.log('[SIAP] Executando safeDoPostBack manual para:', eventTarget);
  var theForm = document.forms['aspnetForm'] || document.forms[0];
  if (!theForm) {
    theForm =
      document.getElementById('aspnetForm') ||
      document.querySelector('form[method="post"]');
  }
  if (!theForm) {
    console.error('[SIAP] Formulário não encontrado para PostBack.');
    return;
  }

  var targetInput = document.getElementById('__EVENTTARGET');
  var argInput = document.getElementById('__EVENTARGUMENT');

  if (!targetInput) {
    targetInput = document.querySelector('input[name="__EVENTTARGET"]');
  }
  if (!argInput) {
    argInput = document.querySelector('input[name="__EVENTARGUMENT"]');
  }

  if (!targetInput) {
    targetInput = document.createElement('input');
    targetInput.type = 'hidden';
    targetInput.name = '__EVENTTARGET';
    targetInput.id = '__EVENTTARGET';
    theForm.appendChild(targetInput);
  }
  if (!argInput) {
    argInput = document.createElement('input');
    argInput.type = 'hidden';
    argInput.name = '__EVENTARGUMENT';
    argInput.id = '__EVENTARGUMENT';
    theForm.appendChild(argInput);
  }

  targetInput.value = eventTarget != null ? String(eventTarget) : '';
  argInput.value = eventArgument != null ? String(eventArgument) : '';

  theForm.submit();
}

/** Nome completo do professor no portal (`#lblNomeUsuario`) — broadcast DADOS_PROFESSOR / vínculo de licença no mobile. */
const SIAP_USER_NAME_STORAGE_KEY = 'siap_user_name';
/** E-mail do professor no portal (header / mailto / texto) — pareamento mobile / logs. */
const SIAP_USER_EMAIL_STORAGE_KEY = 'siap_user_email';
/** Nome da entidade/escola no portal (`#lblNomeEntidade`) — vínculo homônimos no mobile. */
const SIAP_USER_ESCOLA_STORAGE_KEY = 'siap_user_escola_vinculada';
/** CPF do professor (texto “CPF:” no diário, ex. Histórico detalhado). Mantido apenas para compatibilidade de chave. */
const SIAP_USER_CPF_STORAGE_KEY = 'siap_user_cpf_vinculado';

/**
 * CPF: coleta desativada a pedido do usuário.
 * Mantemos a função por compatibilidade, mas ela sempre retorna string vazia.
 */
function scrapeSiapCpfDigitsFromDom() {
  return '';
}

/** Sincronização de CPF desativada: limpa a chave e não grava novos valores. */
function syncSiapUserCpfToStorage() {
  if (!chrome?.storage?.local) return;
  chrome.storage.local.remove(SIAP_USER_CPF_STORAGE_KEY, () => {
    if (chrome.runtime.lastError) {
      console.warn('SIAP: limpar siap_user_cpf_vinculado (coleta desativada):', chrome.runtime.lastError.message);
    }
  });
}
/** Lê `#lblNomeUsuario` (nome real completo) e fallback por saudação no corpo da página. */
function syncSiapUserNameToStorage() {
  if (!chrome?.storage?.local) return;
  const el = document.getElementById('lblNomeUsuario');
  let raw = el
    ? String(el.innerText || el.textContent || '')
        .trim()
        .replace(/\s+/g, ' ')
    : '';
  if (!raw) {
    const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const m = bodyText.match(/\b(?:bom dia|boa tarde|boa noite)\s*,?\s*prof\.?\s+([a-zà-ú'\- ]{2,})/i);
    raw = m && m[1] ? m[1].trim() : '';
  }
  if (!raw) return;
  chrome.storage.local.set({ [SIAP_USER_NAME_STORAGE_KEY]: raw }, () => {
    if (chrome.runtime.lastError) {
      console.warn('SIAP: siap_user_name:', chrome.runtime.lastError.message);
    }
  });
}

/** Lê `#lblNomeEntidade` (escola/entidade logada) — `escola_vinculada_siap` no Supabase. */
function syncSiapUserEscolaToStorage() {
  if (!chrome?.storage?.local) return;
  const el = document.getElementById('lblNomeEntidade');
  const raw = el
    ? String((el.textContent != null ? el.textContent : el.innerText) || '')
        .trim()
        .replace(/\s+/g, ' ')
    : '';
  if (!raw) {
    chrome.storage.local.remove(SIAP_USER_ESCOLA_STORAGE_KEY, () => {
      if (chrome.runtime.lastError) {
        console.warn('SIAP: limpar siap_user_escola_vinculada:', chrome.runtime.lastError.message);
      }
    });
    return;
  }
  chrome.storage.local.set({ [SIAP_USER_ESCOLA_STORAGE_KEY]: raw }, () => {
    if (chrome.runtime.lastError) {
      console.warn('SIAP: siap_user_escola_vinculada:', chrome.runtime.lastError.message);
    }
  });
}

function normalizeEmailFromString(text) {
  if (!text || typeof text !== 'string') return '';
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].trim().toLowerCase() : '';
}

/** Tenta obter e-mail exibido no SIAP (IDs comuns, mailto:, bloco do nome do usuário). */
function scrapeSiapUserEmailFromDom() {
  const tryIds = [
    'lblEmailUsuario',
    'lblUsuarioEmail',
    'hypEmail',
    'lnkEmailUsuario',
    'ctl00_ctl00_lblEmail',
    'cphTopo_lblEmail',
  ];
  for (let i = 0; i < tryIds.length; i++) {
    const el = document.getElementById(tryIds[i]);
    if (!el) continue;
    const href = el.getAttribute && el.getAttribute('href');
    if (href && /^mailto:/i.test(href)) {
      const raw = href.replace(/^mailto:/i, '').split('?')[0].trim();
      const em = normalizeEmailFromString(raw);
      if (em) return em;
    }
    const raw = (el.innerText || el.textContent || '').trim();
    const em = normalizeEmailFromString(raw);
    if (em) return em;
  }
  const mailtos = document.querySelectorAll('a[href^="mailto:"]');
  for (let j = 0; j < mailtos.length; j++) {
    const a = mailtos[j];
    const raw = (a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0];
    const em = normalizeEmailFromString(raw);
    if (em) return em;
  }
  const nomeEl = document.getElementById('lblNomeUsuario');
  if (nomeEl && nomeEl.parentElement) {
    const container = nomeEl.closest('table') || nomeEl.parentElement;
    let walk = container;
    let depth = 0;
    while (walk && depth < 6) {
      const txt = (walk.innerText || walk.textContent || '');
      const em = normalizeEmailFromString(txt);
      if (em) return em;
      walk = walk.parentElement;
      depth++;
    }
  }
  return '';
}

function syncSiapUserEmailToStorage() {
  if (!chrome?.storage?.local) return;
  const email = scrapeSiapUserEmailFromDom();
  if (!email) {
    // Evita reaproveitar e-mail de outro login quando o SIAP não exibe o campo.
    chrome.storage.local.remove(SIAP_USER_EMAIL_STORAGE_KEY, () => {
      if (chrome.runtime.lastError) {
        console.warn('SIAP: limpar siap_user_email:', chrome.runtime.lastError.message);
      }
    });
    return;
  }
  chrome.storage.local.set({ [SIAP_USER_EMAIL_STORAGE_KEY]: email }, () => {
    if (chrome.runtime.lastError) {
      console.warn('SIAP: siap_user_email:', chrome.runtime.lastError.message);
    }
  });
}

/** Nome + CPF (diário) + escola + e-mail do portal — para broadcast / QR. */
function syncSiapUserProfileToStorage() {
  syncSiapUserNameToStorage();
  syncSiapUserCpfToStorage();
  syncSiapUserEscolaToStorage();
  syncSiapUserEmailToStorage();
}

/** Argumentos de folha do TreeView (não são IDs de botão). */
function isSiapTreePostBackQueueItem(item) {
  if (typeof item !== 'string' || item.length < 2) return false;
  if (item.startsWith('sHabilidades')) return true;
  if (item.startsWith('sMatriz')) return true;
  if (item.startsWith('sObjetivos')) return true;
  if (item.startsWith('sMetodologias')) return true;
  if (item.startsWith('sAvaliações') || item.startsWith('sAvalia')) return true;
  if (item.startsWith('s') && item.indexOf('\\') !== -1) return true;
  return false;
}

function processHeartbeatQueue() {
  const queueStr = localStorage.getItem(QUEUE_KEY);
  if (!queueStr || queueStr === '[]') {
    totalItemsInQueue = 0;
    return;
  }

  console.log('[DEBUG FILA] Tick: Fila detectada. ReadyState:', document.readyState);
  console.log('[DEBUG FILA] Prontidão: isProcessing=', isProcessing, '| siapPrmReady=', siapPrmReady);

  if (isProcessing) {
    console.log('[DEBUG FILA] Aguardando timer do clique anterior (isProcessing=true)');
    return;
  }

  if (!siapPrmReady) {
    console.warn('[DEBUG FILA] Bloqueado: Aguardando estabilização PRM/Contexto...');
    return;
  }

  const isAjaxLoading = document.body.getAttribute('data-siap-ajax') === 'true';
  if (isAjaxLoading) {
    console.warn('[DEBUG FILA] Bloqueado: SIAP sinalizou AJAX em andamento (data-siap-ajax=true)');
    return;
  }

  let queue = [];
  try {
    queue = JSON.parse(queueStr);
  } catch (e) {
    console.error("SIAP [Queue Error]:", e);
    localStorage.removeItem(QUEUE_KEY);
    totalItemsInQueue = 0;
    return;
  }
  
  if (queue.length === 0) {
    localStorage.removeItem(QUEUE_KEY);
    localStorage.removeItem('siap_tree_postback_target');
    console.log("SIAP: Fila de cliques concluída com sucesso!");
    totalItemsInQueue = 0;
    safeSendMessage({ action: "QUEUE_FINISHED" });
    return; 
  }

  // Notifica o React sobre o progresso
  const total = totalItemsInQueue || queue.length;
  if (!totalItemsInQueue) totalItemsInQueue = total;

  const processed = total - queue.length;
  safeSendMessage({ 
    action: "QUEUE_PROGRESS", 
    payload: { current: processed, total: total } 
  });

  const nextItem = queue[0];
  const nextStr = typeof nextItem === 'string' ? nextItem : String(nextItem);

  // Painel React: tabela de sincronização (remaining = itens restantes na fila, incluindo o atual)
  safeSendMessage({ action: 'QUEUE_UPDATE', remaining: queue.length });

  // --- Texto livre (sem postback; processa no mesmo ciclo, sem travar 2,5s) ---
  if (nextStr.startsWith('INJECT_TEXT_METODOLOGIA|||')) {
    const parts = nextStr.split('|||', 2);
    const texto = parts[1] != null ? parts[1] : '';
    const textareaMetodologia =
      document.getElementById('cphFuncionalidade_cphCampos_txtMetodologia') ||
      document.querySelector('textarea[id$="txtMetodologia"]');
    if (textareaMetodologia) {
      textareaMetodologia.value = texto;
      textareaMetodologia.dispatchEvent(new Event('input', { bubbles: true }));
      textareaMetodologia.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('SIAP: Texto livre de Metodologia injetado com sucesso.');
    } else {
      console.warn('SIAP: Textarea Metodologia não encontrada (txtMetodologia).');
    }
    queue.shift();
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    safeSendMessage({ action: 'QUEUE_UPDATE', remaining: queue.length });
    safeSendMessage({ action: 'ITEM_PROCESSED', remaining: queue.length });
    isProcessing = false;
    return;
  }
  if (nextStr.startsWith('INJECT_TEXT_AVALIACAO|||')) {
    const parts = nextStr.split('|||', 2);
    const texto = parts[1] != null ? parts[1] : '';
    const textareaAvaliacao =
      document.getElementById('cphFuncionalidade_cphCampos_txtAvaliacao') ||
      document.querySelector('textarea[id$="txtAvaliacao"]');
    if (textareaAvaliacao) {
      textareaAvaliacao.value = texto;
      textareaAvaliacao.dispatchEvent(new Event('input', { bubbles: true }));
      textareaAvaliacao.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('SIAP: Texto livre de Avaliação injetado com sucesso.');
    } else {
      console.warn('SIAP: Textarea Avaliação não encontrada (txtAvaliacao).');
    }
    queue.shift();
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    safeSendMessage({ action: 'QUEUE_UPDATE', remaining: queue.length });
    safeSendMessage({ action: 'ITEM_PROCESSED', remaining: queue.length });
    isProcessing = false;
    return;
  }

  // --- Fila Turbo: TreeView — postback via DOM (sem javascript: / script inline; CSP-safe) ---
  if (isSiapTreePostBackQueueItem(nextItem)) {
    const treeTarget =
      localStorage.getItem('siap_tree_postback_target') ||
      'ctl00$ctl00$cphFuncionalidade$cphCampos$treeView';

    queue.shift();
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));

    console.log('SIAP: Injetando via DOM Form Submit Seguro ->', treeTarget, '| arg:', nextItem, '| restam:', queue.length);

    isProcessing = true;

    safeSendMessage({ action: 'QUEUE_UPDATE', remaining: queue.length });
    safeSendMessage({
      action: 'ITEM_PROCESSED',
      remaining: queue.length
    });

    safeDoPostBack(treeTarget, nextItem);

    setTimeout(() => {
      isProcessing = false;
    }, 4500); // 4.5s: dá tempo ao safeDoPostBack/UpdatePanel do SIAP completar
    return;
  }

  const btnElement = document.getElementById(nextItem);

  if (btnElement) {
    queue.shift();
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));

    console.log('[🟢 QUEUE TICK] ===== CLICKING BUTTON =====');
    console.log('[🟢 QUEUE TICK] Btn ID:', nextItem);
    console.log('[🟢 QUEUE TICK] Btn type:', btnElement.type, '| tag:', btnElement.tagName);
    console.log('[🟢 QUEUE TICK] Btn value:', btnElement.value || '(sem value)');
    console.log('[🟢 QUEUE TICK] Btn text:', btnElement.outerHTML.substring(0, 200));
    console.log('[🟢 QUEUE TICK] Restam na fila:', queue.length);

    safeSendMessage({ action: 'QUEUE_UPDATE', remaining: queue.length });
    safeSendMessage({
      action: 'ITEM_PROCESSED',
      remaining: queue.length
    });

    isProcessing = true;
    if (btnElement.type === "checkbox" && btnElement.checked) {
      console.log("[🟢 QUEUE TICK] Checkbox já marcado, ignorando clique:", nextItem);
    } else {
      btnElement.click();
      console.log("[🟢 QUEUE TICK] CLICK disparado em:", nextItem);
    }

    setTimeout(() => {
      isProcessing = false;
    }, 4500); // 4.5s: dá tempo ao UpdatePanel/AJAX do SIAP processar o Executar

  } else {
    // Botão não encontrado; aguarda próximo tick (postback / DOM).
    console.warn('[🟢 QUEUE TICK] Botão não encontrado no DOM:', nextItem);
    console.warn('[🟢 QUEUE TICK] Fila atual:', JSON.stringify(queue).substring(0, 500));

    // Verifica se o SIAP está em meio a postback
    const isAjaxLoading = document.body.getAttribute('data-siap-ajax') === 'true';
    console.warn('[🟢 QUEUE TICK] SIAP ajax loading:', isAjaxLoading);
    console.warn('[🟢 QUEUE TICK] URL atual:', window.location.href);

    // Se o botão não existe, pode ser que a página já mudou (postback/reload)
    // ou o nome do ID está errado. Removemos o item para não travar a fila.
    if (isAjaxLoading) {
      console.log('[🟢 QUEUE TICK] SIAP ainda carregando — mantendo item na fila, tentando no próximo tick');
    } else {
      // Remove o item inválido e continua
      const invalidItem = queue.shift();
      console.warn('[🟢 QUEUE TICK] Removendo item invalido da fila:', invalidItem);
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      safeSendMessage({ action: 'QUEUE_UPDATE', remaining: queue.length });
    }
  }
}

// Inicia o batimento cardíaco da extensão: checa a fila a cada 1 segundo
setInterval(processHeartbeatQueue, 1000);

// --- Shared Helpers ---

/** Logs detalhados do scrape de planejamento (Console F12 na aba do SIAP). Desligue após depurar. */
const SIAP_DEBUG_SCRAPE = true;

function siapLogScrape(...args) {
  if (SIAP_DEBUG_SCRAPE) console.log('SIAP [PlanejScrape]', ...args);
}

/** URLs em que o scrape de planejamento (data-canonica + meses corretos) deve prevalecer sobre o modo frequência. */
function isSiapPlanningCalendarUrl(href) {
  const h = String(href || window.location.href || '').toLowerCase();
  return (
    h.includes('planejamento_calendario.aspx') ||
    h.includes('planejamentoprofessorturmaedicao.aspx') ||
    h.includes('planejamentoprofessorplanejamentoaulaedicao.aspx')
  );
}

/** data-canonica pode estar no <td> ou em filho (div interna). */
function getPlanningCellCanon(td) {
  if (!td) return null;
  const own = td.getAttribute('data-canonica');
  if (own) return own;
  const inner = td.querySelector('[data-canonica]');
  return inner ? inner.getAttribute('data-canonica') : null;
}

/** Localiza nó com data-canonica exata (evita problemas de escape em seletores CSS). */
function findNodeByDataCanonica(value) {
  if (!value) return null;
  const nodes = document.querySelectorAll('[data-canonica]');
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].getAttribute('data-canonica') === value) return nodes[i];
  }
  return null;
}

function findClickablePlanningCellForCanon(value) {
  const node = findNodeByDataCanonica(value);
  if (!node) return null;
  return node.closest('td.letivo') || node.closest('td') || node;
}

/**
 * Cor de fundo “azul SIAP” em qualquer elemento (td ou div interno).
 */
function elementIsPlanningBlue(el) {
  if (!el || el.nodeType !== 1) return false;
  const style = window.getComputedStyle(el);
  const bg = style.backgroundColor;
  if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return false;
  const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return false;
  const r = parseInt(m[1], 10);
  const g = parseInt(m[2], 10);
  const b = parseInt(m[3], 10);
  return b >= 95 && b > r + 15 && b > g - 20 && r < 145 && g < 175;
}

function tdSubtreeHasBluePending(td) {
  if (elementIsPlanningBlue(td)) return true;
  const inner = td.querySelectorAll('div, span, a');
  for (let i = 0; i < inner.length; i++) {
    if (elementIsPlanningBlue(inner[i])) return true;
  }
  return false;
}

function attrPlanejadoTrueInCell(td) {
  const check = (el) => {
    if (!el) return false;
    const v = el.getAttribute('data-planejado') || (el.dataset && el.dataset.planejado);
    if (v == null || v === '') return false;
    const s = String(v).trim().toLowerCase();
    return s === 'true' || s === '1';
  };
  if (check(td)) return true;
  const marked = td.querySelectorAll('[data-planejado]');
  for (let i = 0; i < marked.length; i++) {
    if (check(marked[i])) return true;
  }
  return false;
}

async function getQueue() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(result[STORAGE_KEY] || []);
    });
  });
}

async function saveQueue(queue) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: queue }, resolve);
  });
}

function detectServerError() {
  const text = document.body.innerText.toLowerCase();
  const title = document.title.toLowerCase();
  return title.includes("server error") || 
         title.includes("erro de servidor") || 
         text.includes("runtime error") || 
         text.includes("erro 500") ||
         text.includes("timed out");
}

function getStudentNumberFromText(text) {
  if (!text) return null;
  const parts = text.split(".");
  if (parts.length > 0) {
    const num = parseInt(parts[0].trim(), 10);
    return isNaN(num) ? null : num;
  }
  return null;
}

function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) return resolve(element);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        resolve(el);
        observer.disconnect();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for selector: ${selector}`));
    }, timeout);
  });
}

// --- Page: FrequenciaAlunoEdicao.aspx ---

async function processNextTask() {
  if (detectServerError()) {
    console.log("SIAP: Erro de servidor detectado. Fila pausada.");
    safeSendMessage({ action: "SYNC_STATUS", status: "OFFLINE", error: "Erro de Servidor" });
    return;
  }

  const queue = await getQueue();
  if (queue.length === 0) {
    safeSendMessage({ action: "SYNC_STATUS", status: "IDLE" });
    return;
  }

  safeSendMessage({ action: "SYNC_STATUS", status: "SYNCING", count: queue.length });

  const nextTask = queue[0];
  
  // Handle Legacy (number only) or Object based tasks
  if (typeof nextTask === 'number') {
    // Legacy Absence Logic
    try {
      await waitForElement("tr");
    } catch (e) {
      return;
    }

    const rows = document.querySelectorAll("tr");
    let targetRow = null;

    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length > 0) {
        const cellText = cells[0].innerText || cells[1]?.innerText || "";
        if (getStudentNumberFromText(cellText.trim()) === nextTask) {
          targetRow = row;
          break;
        }
      }
    }

    if (targetRow) {
      const input = targetRow.querySelector('input[type="checkbox"], input[type="text"], input[type="radio"]');
      if (input) {
        const remaining = queue.slice(1);
        await saveQueue(remaining);

        if (input.type === "checkbox") {
          if (!input.checked) input.click();
          else processNextTask();
        } else if (input.type === "text") {
          input.value = "F";
          input.dispatchEvent(new Event("change", { bubbles: true }));
          input.dispatchEvent(new Event("blur", { bubbles: true }));
          setTimeout(processNextTask, 500);
        } else {
          input.click();
        }
      } else {
        await saveQueue(queue.slice(1));
        processNextTask();
      }
    } else {
      await saveQueue(queue.slice(1));
      processNextTask();
    }
  } else if (nextTask && nextTask.type === 'CLICK_ASPX_SUBMIT') {
    // New Click Logic
    const btnId = nextTask.btnId;
    const btn = document.getElementById(btnId);
    if (btn) {
      console.log("SIAP: Executando clique em lote: " + btnId);
      const remaining = queue.slice(1);
      await saveQueue(remaining);
      btn.click(); // This will usually causes postback/reload
    } else {
      console.warn("SIAP: Botão não encontrado: " + btnId);
      await saveQueue(queue.slice(1));
      processNextTask();
    }
  }
}

function getExtractedDate() {
  const dateInput = document.getElementById('cphFuncionalidade_cphCampos_txtDataSelecionada');
  if (dateInput && dateInput.value) {
    const parts = dateInput.value.split('/');
    if (parts.length > 0) return parts[0]; // Return only the day
  }
  return null;
}

function tdHasPlanejada(td) {
  if (td.classList.contains('planejada')) return true;
  return td.querySelector('.planejada') !== null;
}

function tdHasNaoPlanejada(td) {
  if (/naoplanejada/i.test(td.className)) return true;
  return (
    td.querySelector('.naoPlanejada') !== null ||
    td.querySelector('[class*="naoPlanejada"]') !== null ||
    td.querySelector('[class*="NaoPlanejada"]') !== null
  );
}

/**
 * Extrai dias pendentes: regra estrita (.naoPlanejada + não planejado + data-canonica)
 * e fallback para azul na subárvore (cor costuma estar no div interno, não no td).
 */
function scrapePlanningPendingDaysList() {
  const pendingDaysList = [];
  const seen = new Set();

  const tryPush = (td, dataCanonica, reason) => {
    if (!dataCanonica || seen.has(dataCanonica)) return;
    const textNode = td.querySelector('div')?.childNodes[0];
    let dayNumber = textNode ? String(textNode.nodeValue || '').trim() : '';
    if (!dayNumber) {
      const tail = dataCanonica.split('/').pop();
      if (tail) dayNumber = String(parseInt(tail.trim(), 10));
    }
    if (!dayNumber) return;
    const day = parseInt(dayNumber, 10);
    if (isNaN(day) || day < 1 || day > 31) return;
    pendingDaysList.push({ day, dataCanonica });
    seen.add(dataCanonica);
    siapLogScrape('pendente', reason, dataCanonica, 'dia', day);
  };

  let tds = document.querySelectorAll('td.letivo, td[class*="letivo"]');
  if (tds.length === 0) {
    siapLogScrape('nenhum td.letivo; usando <td> que tenham data-canonica (td ou filho)...');
    tds = Array.from(document.querySelectorAll('td')).filter((td) => !!getPlanningCellCanon(td));
  }
  siapLogScrape('células candidatas:', tds.length, '| total [data-canonica] na página:', document.querySelectorAll('[data-canonica]').length);

  tds.forEach((td) => {
    const dataCanon = getPlanningCellCanon(td);
    if (!dataCanon) return;

    const plannedAttr = attrPlanejadoTrueInCell(td);
    const hasGreenPlanejada = tdHasPlanejada(td);

    if (tdHasNaoPlanejada(td) && !plannedAttr) {
      tryPush(td, dataCanon, 'naoPlanejada');
      return;
    }

    if (!plannedAttr && !hasGreenPlanejada && tdSubtreeHasBluePending(td)) {
      tryPush(td, dataCanon, 'azul-subarvore');
    }
  });

  if (pendingDaysList.length === 0 && SIAP_DEBUG_SCRAPE) {
    console.warn('SIAP [PlanejScrape] Nenhum pendente. Amostra das primeiras células:');
    Array.from(tds)
      .slice(0, 12)
      .forEach((td, i) => {
        const div = td.querySelector('div');
        console.warn(`  [${i}] canon=`, getPlanningCellCanon(td), 'tdBg=', window.getComputedStyle(td).backgroundColor, 'divBg=', div ? window.getComputedStyle(div).backgroundColor : '(sem div)', 'class=', td.className);
      });
  } else {
    siapLogScrape('total pendentes:', pendingDaysList.length);
  }

  return pendingDaysList;
}

function getPendingDays() {
  const isPlanningCalendar = isSiapPlanningCalendarUrl(window.location.href);

  const monthNames = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const todayZero = new Date();
  todayZero.setHours(23, 59, 59, 999);

  if (isPlanningCalendar) {
    const pendingDaysList = scrapePlanningPendingDaysList();
    const monthsMap = new Map();

    pendingDaysList.forEach(({ dataCanonica }) => {
      const parts = dataCanonica.split('/').map(p => parseInt(String(p).trim(), 10));
      if (parts.length !== 3 || parts.some(n => isNaN(n))) return;
      const y = parts[0];
      const mo = parts[1];
      const d = parts[2];
      // Planejamento: exibe TODOS os dias pendentes, passados e futuros,
      // pois o professor precisa planejar aulas que ainda vão acontecer.

      const key = `${y}-${mo}`;
      if (!monthsMap.has(key)) {
        monthsMap.set(key, {
          month: mo,
          year: y,
          monthName: monthNames[mo].toUpperCase(),
          days: []
        });
      }
      const bucket = monthsMap.get(key).days;
      if (!bucket.some(x => x.dataCanonica === dataCanonica)) {
        bucket.push({ day: d, dataCanonica });
      }
    });

    const finalMonths = Array.from(monthsMap.values()).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });

    finalMonths.forEach(m => {
      m.days.sort((a, b) => {
        const pa = a.dataCanonica.split('/').map(x => parseInt(String(x).trim(), 10));
        const pb = b.dataCanonica.split('/').map(x => parseInt(String(x).trim(), 10));
        const da = new Date(pa[0], pa[1] - 1, pa[2]);
        const db = new Date(pb[0], pb[1] - 1, pb[2]);
        return da - db;
      });
    });

    return finalMonths;
  }

  // --- Frequência / conteúdo: células azuis (comportamento anterior), dias como { day, dataCanonica: null } ---
  const dateInput = document.getElementById('cphFuncionalidade_cphCampos_txtDataSelecionada');
  let today = new Date();
  let viewedMonth = today.getMonth() + 1;
  let viewedYear = today.getFullYear();

  if (dateInput && dateInput.value) {
    const parts = dateInput.value.split('/');
    if (parts.length === 3) {
      viewedMonth = parseInt(parts[1], 10);
      viewedYear = parseInt(parts[2], 10);
    }
  }

  const cells = Array.from(document.querySelectorAll('td')).filter(td => {
    const style = window.getComputedStyle(td);
    const bg = style.backgroundColor;
    if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return false;
    const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);
      return b > 140 && r < 120 && g < 150;
    }
    return bg.includes('blue');
  });

  const monthsMap = new Map();

  cells.forEach(td => {
    const dayStr = td.innerText.trim();
    const day = parseInt(dayStr, 10);
    if (isNaN(day) || day < 1 || day > 31) return;

    let currentM = viewedMonth;
    let currentY = viewedYear;

    // Prioridade: data-canonica no <td> (páginas de conteúdo/frequência modernas têm esse atributo).
    // Evita que o innerText do <select> (que começa em "Janeiro") enganhe a heurística de texto.
    const canonAttr = td.getAttribute('data-canonica');
    if (canonAttr) {
      const cParts = canonAttr.split('/').map(p => parseInt(String(p).trim(), 10));
      if (cParts.length === 3 && !cParts.some(n => isNaN(n))) {
        currentY = cParts[0];
        currentM = cParts[1];
      }
    } else {
      // Fallback: heurística de texto para páginas legadas sem data-canonica
      let el = td;
      for (let step = 0; step < 6 && el; step++) {
        const table = el.closest('table');
        const contextText = (
          (table ? table.innerText.slice(0, 1200) : '') +
          ' ' + (el.innerText || '') +
          ' ' + (el.previousElementSibling?.innerText || '') +
          ' ' + (el.parentElement?.innerText?.slice(0, 400) || '')
        ).toLowerCase();
        for (let i = 1; i <= 12; i++) {
          if (contextText.includes(monthNames[i].toLowerCase())) {
            currentM = i;
            break;
          }
        }
        const yMatch = contextText.match(/20\d{2}/);
        if (yMatch) currentY = parseInt(yMatch[0], 10);
        el = el.parentElement;
      }
    }

    const key = `${currentY}-${currentM}`;
    if (!monthsMap.has(key)) {
      monthsMap.set(key, {
        month: currentM,
        year: currentY,
        monthName: monthNames[currentM].toUpperCase(),
        days: []
      });
    }
    const bucket = monthsMap.get(key).days;
    if (!bucket.some(x => x.day === day)) {
      bucket.push({ day, dataCanonica: canonAttr || null });
    }
  });

  const finalMonths = Array.from(monthsMap.values()).sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });
  finalMonths.forEach(m => m.days.sort((a, b) => a.day - b.day));
  return finalMonths;
}

const SIAP_AVANCAR_APOS_SALVAR_KEY = 'SIAP_AVANCAR_APOS_SALVAR';

function queueHasPendingClickItems() {
  try {
    const q = localStorage.getItem(QUEUE_KEY);
    if (!q || q === '[]') return false;
    const parsed = JSON.parse(q);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

/** Primeiro dia pendente (cronológico) para automação "Iniciar planejamento". */
function getFirstPendingDayEntry() {
  const months = getPendingDays();
  const flat = [];
  
  // Referência de "Hoje" (limite máximo para Frequência/Conteúdo)
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const isPlanning = isSiapPlanningCalendarUrl(window.location.href);

  months.forEach(m => {
    (m.days || []).forEach(d => {
      const entry = typeof d === 'number' ? { day: d, dataCanonica: null } : d;
      
      // Se não for planejamento (ou seja, se for Conteúdo ou Frequência),
      // filtramos para não avançar para o futuro.
      if (!isPlanning) {
        let entryDate = null;
        if (entry.dataCanonica) {
          const p = entry.dataCanonica.split('/').map(x => parseInt(String(x).trim(), 10));
          entryDate = new Date(p[0], p[1] - 1, p[2]);
        } else {
          entryDate = new Date(m.year, m.month - 1, entry.day);
        }

        if (entryDate > todayEnd) return;
      }
      
      flat.push(entry);
    });
  });

  flat.sort((a, b) => {
    if (a.dataCanonica && b.dataCanonica) {
      const pa = a.dataCanonica.split('/').map(x => parseInt(String(x).trim(), 10));
      const pb = b.dataCanonica.split('/').map(x => parseInt(String(x).trim(), 10));
      return new Date(pa[0], pa[1] - 1, pa[2]) - new Date(pb[0], pb[1] - 1, pb[2]);
    }
    return a.day - b.day;
  });
  return flat[0] || null;
}

/**
 * Clique no calendário (conteúdo / frequência) — mesma ideia de SELECT_CALENDAR_DAY.
 * @returns {boolean}
 */
function clickPendingCalendarCell(first) {
  if (!first) return false;
  if (first.dataCanonica) {
    const tdCanon = findClickablePlanningCellForCanon(first.dataCanonica);
    if (tdCanon) {
      const clickable = tdCanon.querySelector('a') || tdCanon;
      clickable.click();
      clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    }
  }
  const targetDay = String(first.day);
  const tds = Array.from(document.querySelectorAll('td.letivo, td.calendario-dia, table td'));
  const dayCell = tds.find((td) => {
    const text = td.innerText.trim();
    return text === targetDay || text === '0' + targetDay;
  });
  if (dayCell) {
    const clickable = dayCell.querySelector('a') || dayCell;
    clickable.click();
    clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }
  return false;
}

/**
 * Navegação guiada pós-salvamento (mobile):
 * Hierarquia de decisão:
 *   1. Tem botão [Remover] na página? = algo foi executado nesta aula pelo mobile.
 *      1a. Tem próxima aula no dropdown? → avança para a próxima AULA (geminada).
 *      1b. Não tem próxima aula?          → avança para o próximo DIA pendente.
 *   2. Sem [Remover] → não faz nada (segurança: nada foi realmente executado).
 */
function trySiapAvancarAposSalvarFromConteudoInit() {
  try {
    if (sessionStorage.getItem(SIAP_AVANCAR_APOS_SALVAR_KEY) !== 'true') return;
    if (queueHasPendingClickItems()) {
      console.log('SIAP: [Avançar pós-salvar] Fila de cliques ainda pendente — aguardando.');
      return;
    }

    // Sinal confiável de execução: presença de botão [Remover] na página.
    const btnsRemover = document.querySelectorAll(
      'input[type="submit"][value="Remover"]:not([disabled]),'
      + 'input[type="submit"][value="Remover "]:not([disabled])'
    );
    const aulaFoiExecutada = btnsRemover.length > 0;

    console.log('[DEBUG AVANCO] Botões Remover detectados:', btnsRemover.length, '| aulaFoiExecutada:', aulaFoiExecutada);
    if (btnsRemover.length > 0) {
      console.log('[DEBUG AVANCO] IDs dos botões Remover:', Array.from(btnsRemover).map(b => b.id));
    }

    if (!aulaFoiExecutada) {
      // Nenhum item foi efetivamente executado — limpa a flag e não avança.
      console.log('SIAP: [Avançar pós-salvar] Nenhum [Remover] detectado — possivelmente só abriu a página. Aguardando.');
      sessionStorage.removeItem(SIAP_AVANCAR_APOS_SALVAR_KEY);
      return;
    }

    // Verifica se há PRÓXIMA AULA no dropdown (caso geminada).
    const dd = document.getElementById('cphFuncionalidade_cphCampos_LstAulasDiaSelecionado');
    const temProximaAula = dd && dd.options && (dd.selectedIndex + 1) < dd.options.length;

    if (temProximaAula) {
      // GEMINADA: avança para a próxima aula do mesmo dia.
      const nomeProxima = dd.options[dd.selectedIndex + 1].text;
      console.log('SIAP: [Avançar pós-salvar] GEMINADA detectada — avançando para:', nomeProxima);
      sessionStorage.removeItem(SIAP_AVANCAR_APOS_SALVAR_KEY);
      siapAvancarParaProximaAula(dd);
      return;
    }

    // AULA ÚNICA (ou última aula do dia): avança para o próximo dia pendente.
    // Lê o dia atualmente aberto na página para não re-selecionar o mesmo dia.
    const dateInput = document.getElementById('cphFuncionalidade_cphCampos_txtDataSelecionada');
    const diaAtualSiap = dateInput && dateInput.value ? dateInput.value.trim() : null; // "dd/mm/aaaa"

    const first = getFirstPendingDayEntry();
    if (first) {
      // Verifica se o dia retornado é o mesmo que está aberto — se for, o calendário
      // ainda não atualizou visualmente (bug de loop). Nesse caso, não fazemos nada.
      let firstCanonica = first.dataCanonica; // "YYYY/M/D"
      if (!firstCanonica && diaAtualSiap) {
        // Tenta construir a canônica a partir do dia e do mês/ano da data atual no SIAP
        const parts = diaAtualSiap.split('/'); // ["08","04","2026"]
        if (parts.length === 3) {
          firstCanonica = `${parts[2]}/${parseInt(parts[1], 10)}/${first.day}`;
        }
      }
      let mesmoDia = false;
      if (firstCanonica && diaAtualSiap) {
        const parts = diaAtualSiap.split('/');
        if (parts.length === 3) {
          const canonAtual = `${parts[2]}/${parseInt(parts[1], 10)}/${parseInt(parts[0], 10)}`;
          const canonFirst = firstCanonica.split('/').map(x => parseInt(String(x).trim(), 10)).join('/');
          const canonAtualNorm = canonAtual.split('/').map(x => parseInt(String(x).trim(), 10)).join('/');
          mesmoDia = canonFirst === canonAtualNorm;
        }
      }

      if (mesmoDia) {
        console.log('SIAP: [Avançar pós-salvar] Próximo pendente é o mesmo dia atual (' + diaAtualSiap + ') — calendário ainda não atualizou. Nenhum dia pendente (inbox zero).');
        sessionStorage.removeItem(SIAP_AVANCAR_APOS_SALVAR_KEY);
        try { safeSendMessage({ action: 'INBOX_ZERO' }); } catch (e) { /* ignore */ }
        return;
      }

      console.log('SIAP: [Avançar pós-salvar] Aula única/última — abrindo próximo dia pendente:', first);
      sessionStorage.removeItem(SIAP_AVANCAR_APOS_SALVAR_KEY);
      clickPendingCalendarCell(first);
      return;
    }

    console.log('SIAP: [Avançar pós-salvar] Nenhum dia pendente (inbox zero).');
    sessionStorage.removeItem(SIAP_AVANCAR_APOS_SALVAR_KEY);
    try {
      safeSendMessage({ action: 'INBOX_ZERO' });
    } catch (e) {
      /* ignore */
    }
  } catch (e) {
    console.error('SIAP: [Avançar pós-salvar] erro:', e);
    try {
      sessionStorage.removeItem(SIAP_AVANCAR_APOS_SALVAR_KEY);
    } catch (e2) {
      /* ignore */
    }
  }
}

function enterNextPlanejamento() {
  const first = getFirstPendingDayEntry();
  if (!first) {
    console.log('SIAP: Nenhum dia pendente de planejamento encontrado.');
    return;
  }
  if (first.dataCanonica) enterPlanejamentoDay(first.dataCanonica);
  else enterPlanejamentoDay(first.day);
}

function getStudentsList() {
  const students = [];
  // Use the specific SIAP classes found in the provided HTML
  const studentItems = document.querySelectorAll('.listaDeAlunos .item');
  
  studentItems.forEach((item, index) => {
    const matricula = item.getAttribute('data-matricula');
    const nameDiv = item.querySelector('.aluno');
    if (matricula && nameDiv) {
      const fullText = nameDiv.innerText.trim();
      // Extract number and name: "1. AGHATA ARYELLA..."
      const match = fullText.match(/^(\d+)\.\s+(.*)/);
      if (match) {
        students.push({
          number: parseInt(match[1]),
          name: match[2].trim(),
          matricula: matricula,
          rowIdx: index
        });
      }
    }
  });

  // Fallback to the previous generic logic if the specific classes aren't found
  if (students.length === 0) {
    const divs = Array.from(document.querySelectorAll("div, span, td")).filter(el => {
      if (el.children.length > 3) return false;
      const text = el.innerText.trim();
      return /^\d+\.\s+[A-Z\s]{4,}/.test(text);
    });
    const seen = new Set();
    divs.forEach((div, i) => {
      const match = div.innerText.trim().match(/^(\d+)\.\s+([A-Z\s]+)/);
      if (match) {
        const key = `${match[1]}-${match[2]}`;
        if (!seen.has(key)) {
          seen.add(key);
          students.push({ number: parseInt(match[1]), name: match[2].trim(), rowIdx: i });
        }
      }
    });
  }

  return students;
}

/**
 * Extrai __doPostBack('eventTarget','argument') de href (TreeView / links ASP.NET).
 */
function parseDoPostBackFromHref(href) {
  if (!href || href.indexOf('__doPostBack') === -1) return null;
  const s = href.replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const start = s.indexOf('__doPostBack');
  const open = s.indexOf('(', start);
  if (open === -1) return null;
  let i = open + 1;
  function readQuotedString() {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) return null;
    const q = s[i];
    if (q !== "'" && q !== '"') return null;
    i++;
    let buf = '';
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) {
        buf += s[i + 1];
        i += 2;
        continue;
      }
      if (c === q) {
        i++;
        return buf;
      }
      buf += c;
      i++;
    }
    return null;
  }
  const eventTarget = readQuotedString();
  while (i < s.length && (s[i] === ',' || /\s/.test(s[i]))) i++;
  const argument = readQuotedString();
  if (eventTarget == null || argument == null) return null;
  return { eventTarget, argument };
}

function categoriaPlanejamentoPorArg(postBackArg) {
  if (!postBackArg) return 'Outros';
  if (postBackArg.startsWith('sHabilidades')) return 'Habilidades';
  if (postBackArg.startsWith('sMatriz')) return 'Matriz SAEB';
  if (postBackArg.startsWith('sObjetivos')) return 'Conteúdos';
  if (postBackArg.startsWith('sMetodologias')) return 'Metodologias';
  if (postBackArg.startsWith('sAvaliações') || postBackArg.startsWith('sAvalia')) return 'Avaliações';
  return 'Outros';
}

/** Folhas do TreeView nativo (.EstiloNoFolha) para o modo Turbo no painel. */
function scrapePlanejamentoTreeOptions() {
  const planejamentoOptions = [];
  let planejamentoTreeEventTarget = null;
  const folhas = document.querySelectorAll('a.EstiloNoFolha');
  const seen = new Set();

  folhas.forEach((folha) => {
    const href = folha.getAttribute('href');
    if (!href || !href.includes('__doPostBack')) return;
    const parsed = parseDoPostBackFromHref(href);
    if (!parsed) return;
    if (!planejamentoTreeEventTarget) planejamentoTreeEventTarget = parsed.eventTarget;
    const postBackArg = parsed.argument;
    const texto = (folha.innerText || '').trim();
    if (!postBackArg || !texto) return;
    if (seen.has(postBackArg)) return;
    seen.add(postBackArg);
    planejamentoOptions.push({
      categoria: categoriaPlanejamentoPorArg(postBackArg),
      texto,
      postBackArg
    });
  });

  if (!planejamentoTreeEventTarget && planejamentoOptions.length > 0) {
    planejamentoTreeEventTarget = 'ctl00$ctl00$cphFuncionalidade$cphCampos$treeView';
  }

  const eixo = scrapeDdlEixo();
  return {
    planejamentoOptions,
    planejamentoTreeEventTarget,
    unidadesTematicas: eixo.unidadesTematicas,
    unidadeAtiva: eixo.unidadeAtiva,
  };
}

/**
 * Unidade Temática no SIAP: <select id="ddlEixo"> (postback ao alterar — atualiza a árvore).
 * Enviado em pageStats.unidadesTematicas / unidadeAtiva.
 */
/**
 * Dropdown de aulas do dia (conteúdo programático / aulas geminadas).
 * IDs típicos: #cphFuncionalidade_cphCampos_LstAulasDiaSelecionado
 */
function scrapeAulasDiaDropdown() {
  const dropdownAulas = document.getElementById('cphFuncionalidade_cphCampos_LstAulasDiaSelecionado');
  const aulasDisponiveis =
    dropdownAulas && dropdownAulas.options
      ? Array.from(dropdownAulas.options).map((opt) => (opt.value != null ? String(opt.value) : ''))
      : [];
  const aulaAtual = dropdownAulas && dropdownAulas.value != null ? String(dropdownAulas.value) : '';
  return { aulasDisponiveis, aulaAtual };
}

/**
 * Detecta se a aula ATUAL no SIAP JÁ foi lançada.
 *
 * ATENÇÃO: NÃO use GrdConteudoRealizado — essa tabela acumula o conteúdo
 * do DIA INTEIRO (todas as aulas), gerando falso positivo na 2ª Aula
 * logo após a 1ª ter sido salva.
 *
 * Lógica correta (baseada no estado real dos botões da aula atual):
 *
 *  1. Se ainda existem botões "Executar" habilitados na grade de conteúdo
 *     → a aula atual ainda TEM itens não executados → VAZIA → false
 *
 *  2. Se não há botões "Executar" E o campo de conteúdo livre está vazio
 *     E não há botão "Salvar" → provavelmente sem planejamento (ex: feriado) → false
 *
 *  3. Se não há botões "Executar" E (há botões "Remover" OU campo livre preenchido)
 *     → todos os itens foram executados → PREENCHIDA → true
 *
 * Retorna true → aula preenchida; false → aula vazia/pronta para injeção.
 */
function siapAulaJaPreenchida() {
  const ddAula = document.getElementById('cphFuncionalidade_cphCampos_LstAulasDiaSelecionado');
  const idxAula = ddAula && ddAula.selectedIndex !== -1 ? ddAula.selectedIndex : 'N/A';
  const txtAula = ddAula && ddAula.options && ddAula.options[idxAula] ? ddAula.options[idxAula].text : 'N/A';

  console.log('[SIAP GEMINADA DEBUG] ===== siapaJaPreenchida START =====');
  console.log('[SIAP GEMINADA DEBUG] Aula atual dropdown: idx=' + idxAula + ' | texto="' + txtAula + '" | total=' + (ddAula ? ddAula.options.length : 0));

  // --- Passo 1 (NOVO): botões "Remover" — sinal CONFIÁVEL de execução. ---
  // O SIAP mantém [Executar] na lista de planejados/materiais SEMPRE visíveis,
  // independentemente do que já foi executado. O [Remover] só aparece nas seções
  // "Conteúdo Ministrado" e "Material de Apoio Utilizado", que só existem
  // quando ao menos um item foi efetivamente executado na aula atual.
  const btnsRemover = document.querySelectorAll(
    'input[type="submit"][value="Remover"]:not([disabled]),'
    + 'input[type="submit"][value="Remover "]:not([disabled])'
  );

  console.log('[SIAP GEMINADA DEBUG] Passo 1 — Botões Remover (indicador primário):', btnsRemover.length,
    '(IDs:', Array.from(btnsRemover).slice(0, 5).map(b => b.id).join(', ') || 'nenhum', ')');

  if (btnsRemover.length > 0) {
    console.log('[SIAP GEMINADA DEBUG] → RESULTADO: aula PREENCHIDA (Remover=' + btnsRemover.length + ')');
    console.log('[SIAP GEMINADA DEBUG] ===== siapaJaPreenchida END =====');
    return true;
  }

  // --- Passo 2: campo de conteúdo livre preenchido ---
  const txtLivre =
    document.getElementById('cphFuncionalidade_cphCampos_TxtConteudoLivreExecutado') ||
    document.querySelector('textarea[id*="ConteudoLivre"]') ||
    document.querySelector('textarea[id*="txtConteudo"]');
  const valorLivre = (txtLivre && txtLivre.value ? txtLivre.value.trim() : '');

  console.log('[SIAP GEMINADA DEBUG] Passo 2 — Textarea livre:', !!txtLivre, '| valorLength=' + valorLivre.length);

  if (valorLivre.length > 0) {
    console.log('[SIAP GEMINADA DEBUG] → RESULTADO: aula PREENCHIDA (conteúdo livre presente)');
    console.log('[SIAP GEMINADA DEBUG] ===== siapaJaPreenchida END =====');
    return true;
  }

  // --- Passo 3 (informativo): conta [Executar] apenas para log ---
  const btnsExecutar = document.querySelectorAll('input[type="submit"][value="Executar"]:not([disabled])');
  console.log('[DEBUG DETECCAO] Passo 3 (info) — Botões Executar totais:', btnsExecutar.length);
  if (btnsExecutar.length > 0) {
    const listE = Array.from(btnsExecutar).slice(0, 3).map(b => b.id);
    console.log('[DEBUG DETECCAO] Exemplos de IDs Executar:', listE);
  }

  console.log('[DEBUG DETECCAO] → RESULTADO FINAL: aula VAZIA (sem Remover, sem conteúdo livre)');
  console.log('[DEBUG DETECCAO] ===== siapAulaJaPreenchida END =====');
  return false;
}

/**
 * Avança o dropdown de aulas para o próximo índice e dispara PostBack.
 * Retorna true se conseguiu avançar, false se já estava na última.
 */
function siapAvancarParaProximaAula(dd) {
  if (!dd || !dd.options) {
    console.log('[SIAP GEMINADA DEBUG] AvancarAula ABORTADO — dropdown nao encontrado ou sem options');
    return false;
  }
  const proximoIdx = dd.selectedIndex + 1;
  if (proximoIdx >= dd.options.length) {
    console.log('[SIAP GEMINADA DEBUG] AvancarAula ABORTADO — ja estava na ultima aula (idx=' + dd.selectedIndex + ', total=' + dd.options.length + ')');
    return false;
  }
  dd.selectedIndex = proximoIdx;
  const target =
    (dd.name && String(dd.name).trim()) ||
    'ctl00$ctl00$cphFuncionalidade$cphCampos$LstAulasDiaSelecionado';
  const nomeAula = dd.options[proximoIdx].text || String(proximoIdx + 1);
  console.log('[SIAP GEMINADA DEBUG] Avancando para proxima aula: idxAntigo=' + (dd.selectedIndex - 1) + ' → idxNovo=' + proximoIdx + ' → aula="' + nomeAula + '"');
  console.log('[DEBUG AVANCO] Notificando painel sobre mudança de aula...');
  try {
    safeSendMessage({
      action: 'SIAP_AULA_AVANCADA',
      payload: { aulaIdx: proximoIdx, nomeAula },
    });
  } catch (e) { /* ignore */ }
  
  setTimeout(() => {
    console.log('[DEBUG AVANCO] safeDoPostBack disparando AGORA para:', target);
    safeDoPostBack(target, '');
  }, 400);
  return true;
}

/**
 * Smart Geminada: Ao carregar a página de conteúdo, verifica se a aula ATUAL já
 * está preenchida. Se sim (e houver próximas aulas no dropdown), avança automaticamente
 * antes de notificar o Mobile — assim o professor só vê a aula que ainda precisa preencher.
 * Suporta N aulas (não só 2): percorre até encontrar uma vazia ou esgotar as opções.
 */
function initConteudoPage() {
  console.log("SIAP: Iniciando módulo de Lançamento de Conteúdo (v2 Smart Geminada).");
  console.log('[DEBUG INIT] SIAP_AVANCAR_APOS_SALVAR_KEY:', sessionStorage.getItem(SIAP_AVANCAR_APOS_SALVAR_KEY));
  console.log('[DEBUG INIT] URL:', window.location.href);
  console.log('[DEBUG INIT] PageReadyState:', document.readyState);

  /**
   * Aguarda o DOM do ASP.NET terminar de popular (UpdatePanel pode demorar).
   * 1500ms é seguro para a maioria dos cenários; o MutationObserver em
   * initConteudoPagePostGeminada() vai capturar mudanças tardias.
   */
  setTimeout(() => {
    const dd = document.getElementById('cphFuncionalidade_cphCampos_LstAulasDiaSelecionado');
    const totalAulas = dd && dd.options ? dd.options.length : 0;

    if (totalAulas > 1 && siapAulaJaPreenchida()) {
      // Aula atual preenchida — tenta avançar para a próxima
      const avancou = siapAvancarParaProximaAula(dd);
      if (avancou) {
        // O PostBack vai recarregar a página na próxima aula; aguarda reload.
        console.log('[SIAP Smart Geminada] Aguardando reload para próxima aula...');
        return;
      }
      // Não tem próxima aula — todas preenchidas; segue fluxo normal
      console.log('[SIAP Smart Geminada] Todas as aulas do dia já estão preenchidas. Fluxo normal.');
    }

    // Aula atual está vazia (ou é a única) — inicializa normalmente
    initConteudoPagePostGeminada();
  }, 1500);
}




function scrapeDdlEixo() {
  const unidadesTematicas = [];
  let unidadeAtiva = null;
  const eixoSelect =
    document.getElementById('ddlEixo') ||
    document.getElementById('cphFuncionalidade_cphCampos_ddlEixo') ||
    document.querySelector('select[id$="ddlEixo"]');
  if (eixoSelect && eixoSelect.options) {
    Array.from(eixoSelect.options).forEach((opt) => {
      unidadesTematicas.push({
        value: opt.value != null ? String(opt.value) : '',
        text: (opt.textContent || '').replace(/\s+/g, ' ').trim(),
      });
      if (opt.selected) {
        unidadeAtiva = opt.value != null ? String(opt.value) : null;
      }
    });
  }
  return { unidadesTematicas, unidadeAtiva };
}

/**
 * Tenta descobrir o mês/ano visível no calendário do SIAP para exibir no seletor da extensão.
 * Estratégias (em ordem de confiança):
 *   1) Atributo mes= na <table class="mes"> + anocorrente= nos <td>
 *   2) Texto da opção selecionada no <select#selectMesCalendarioMensal>
 *   3) Derivar de diaOficialSiap (dd/mm/aaaa)
 */
function scrapeCalendarVisibleMonthLabel(diaOficialSiapFallback) {
  console.log('SIAP: Iniciando captura do rótulo do mês...');
  var mNames = ['', 'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
    'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

  var anoFromTable = null;
  var calTable = document.querySelector('table.mes[mes]');
  if (calTable) {
    var anoTd = calTable.querySelector('td[anocorrente]');
    if (anoTd) anoFromTable = anoTd.getAttribute('anocorrente');
  }
  var anoFallback = anoFromTable || String(new Date().getFullYear());

  // Estratégia 1: atributo mes= na tabela do calendário (mais confiável)
  if (calTable) {
    var mesAttr = parseInt(calTable.getAttribute('mes'), 10);
    console.log('SIAP: mesAttr na tabela:', mesAttr);
    if (mesAttr >= 1 && mesAttr <= 12) {
      const label = mNames[mesAttr] + ' ' + anoFallback;
      console.log('SIAP: Rótulo capturado (Estratégia 1):', label);
      return label;
    }
  }

  // Estratégia 2: select#selectMesCalendarioMensal (texto da opção selecionada)
  var selMes =
    document.getElementById('selectMesCalendarioMensal') ||
    document.querySelector('select.nome-mes') ||
    document.querySelector('.cabecalho-mes-calendario select');
  if (selMes && selMes.tagName === 'SELECT' && selMes.selectedIndex >= 0) {
    var optText = (selMes.options[selMes.selectedIndex].text || '').trim().toUpperCase();
    console.log('SIAP: Texto do select de mês:', optText);
    if (optText) {
      if (!/20\d{2}/.test(optText)) optText += ' ' + anoFallback;
      console.log('SIAP: Rótulo capturado (Estratégia 2):', optText);
      return optText;
    }
  }

  // Estratégia 3: derivar de diaOficialSiap (dd/mm/aaaa)
  if (diaOficialSiapFallback) {
    var parts = String(diaOficialSiapFallback).split('/');
    if (parts.length === 3) {
      var m = parseInt(parts[1], 10);
      if (m >= 1 && m <= 12) return mNames[m] + ' ' + parts[2];
    }
  }

  return null;
}

function getMissingClassesStats() {
  const table = document.querySelector('table');
  const text = document.body.innerText;
  
  const previstasMatch = text.match(/(\d+)\s*aulas previstas/i);
  const ministradasMatch = text.match(/(\d+)\s*aulas ministradas/i);
  
  const dateInput = document.getElementById('cphFuncionalidade_cphCampos_txtDataSelecionada');
  const selectedDay = dateInput && dateInput.value ? parseInt(dateInput.value.split('/')[0], 10) : null;
  // Contrato único: data completa dd/mm/aaaa — lida pelo mobile como diaOficialSiap.
  const diaOficialSiap = dateInput && dateInput.value ? dateInput.value.trim() : null;
  
  const turmaInput = document.getElementById('cphFuncionalidade_cphCampos_txtTurma');
  const turma = turmaInput ? turmaInput.value.trim() : null;

  const disciplinaInput = document.getElementById('cphFuncionalidade_cphCampos_txtComponenteCurricular') || 
                         document.getElementById('cphFuncionalidade_cphCampos_txtDisciplina');
  const disciplina = disciplinaInput ? disciplinaInput.value.trim() : null;

  const previstas = previstasMatch ? parseInt(previstasMatch[1], 10) : 0;
  const ministradas = ministradasMatch ? parseInt(ministradasMatch[1], 10) : 0;
  
  const isPlanningCalendario = isSiapPlanningCalendarUrl(window.location.href);
  const pendingDaysList = isPlanningCalendario ? scrapePlanningPendingDaysList() : [];

  let planejamentoOptions = [];
  let planejamentoTreeEventTarget = null;
  let unidadesTematicas = [];
  let unidadeAtiva = null;
  if (isPlanningCalendario) {
    const tree = scrapePlanejamentoTreeOptions();
    planejamentoOptions = tree.planejamentoOptions;
    planejamentoTreeEventTarget = tree.planejamentoTreeEventTarget;
    unidadesTematicas = tree.unidadesTematicas || [];
    unidadeAtiva = tree.unidadeAtiva;
  } else {
    const ex = scrapeDdlEixo();
    unidadesTematicas = ex.unidadesTematicas;
    unidadeAtiva = ex.unidadeAtiva;
  }

  const pendingMonths = getPendingDays();
  const pendentesCount = pendingMonths.reduce((acc, m) => acc + m.days.length, 0);
  const students = getStudentsList();

  // New Content Scraping
  let conteudosList = [];
  let materiaisList = [];
  
  const plannedTable = document.getElementById('cphFuncionalidade_cphCampos_grdPlanejado');
  if (plannedTable) {
    const rows = plannedTable.querySelectorAll('tr');
    rows.forEach((row, index) => {
      const descSpan = row.querySelector('.descricao-item-grade');
      const submitBtn = row.querySelector('input[type="submit"]');
      if (descSpan && submitBtn) {
        conteudosList.push({
          id: `cont_${index}`,
          texto: descSpan.innerText.trim(),
          btnId: submitBtn.id
        });
      }
    });
  }

  const materialTable = document.getElementById('cphFuncionalidade_cphCampos_GrdMaterialApoio');
  if (materialTable) {
    const materiaisRows = materialTable.querySelectorAll('tbody tr:not(:first-child)');
    materiaisRows.forEach((row, index) => {
      const descSpan = row.querySelector('.descricao-item-grade');
      const submitBtn = row.querySelector('input[type="submit"]');
      if (descSpan && submitBtn) {
        const textoMaterial = descSpan.innerText.trim();
        // ID estável baseado no texto (normalizado) para persistência
        const stableId = 'mat_' + textoMaterial.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        materiaisList.push({
          id: stableId,
          texto: textoMaterial,
          btnId: submitBtn.id
        });
      }
    });
  }

  const { aulasDisponiveis, aulaAtual } = scrapeAulasDiaDropdown();
  const calendarMonthLabel = scrapeCalendarVisibleMonthLabel(diaOficialSiap);

  const stats = {
    cpfVinculado: '',
    pendentes: pendentesCount,
    previstas,
    ministradas,
    pendingMonths,
    pendingDaysList,
    selectedDay,
    diaOficialSiap,
    calendarMonthLabel,
    students,
    turma,
    disciplina,
    conteudosList,
    materiaisList,
    aulasDisponiveis,
    aulaAtual,
    selecionados: { materiais: [] }, // Padrão: desmarcado (conforme pedido)
    planejamentoOptions,
    planejamentoTreeEventTarget,
    unidadesTematicas,
    unidadeAtiva,
    pageType: window.location.href.toLowerCase().includes('conteudoprogramaticoedicao.aspx') ? 'conteudo' : 
              isSiapPlanningCalendarUrl(window.location.href) ? 'planejamento' :
              window.location.href.toLowerCase().includes('frequenciaprofessorturmaedicao.aspx') || window.location.href.toLowerCase().includes('frequenciaalunoedicao.aspx') ? 'frequencia' : 'frequencia'
  };

  // Se estivermos na página de conteúdo e houver turma, tenta injetar presets de materiais (cache)
  if (stats.pageType === 'conteudo' && stats.turma && stats.materiaisList.length > 0) {
    const cacheKey = `siap_preset_mat_${stats.turma}`;
    const cachedMat = localStorage.getItem(cacheKey);
    if (cachedMat) {
      try {
        const savedTexts = JSON.parse(cachedMat); // Lista de textos "normais"
        if (Array.isArray(savedTexts)) {
          const matchingIds = stats.materiaisList
            .filter(m => savedTexts.includes(m.texto.trim()))
            .map(m => m.id);
          stats.selecionados.materiais = matchingIds;
          console.log(`SIAP: [Cache] Injetando ${matchingIds.length} materiais salvos para a turma ${stats.turma}`);
        }
      } catch (e) { /* ignore */ }
    }
  }
  
  // Return stats if we have basic context (turma/disciplina) or students/days ou opções da árvore Turbo
  if (stats.turma || stats.disciplina || stats.pendingMonths.length > 0 || stats.students.length > 0 || stats.planejamentoOptions.length > 0 || (stats.unidadesTematicas && stats.unidadesTematicas.length > 0)) {
    return stats;
  }
  
  return null;
}

/** Aguarda o DOM parar de “tremer” antes do scrape pesado (parse + JSON + dedupe). */
const SIAP_DOM_SCRAPE_DEBOUNCE_MS = 500;

let siapStatsPushTimer = null;
let siapStatsLastSentJson = null;

function siapNodeIgnorableForStatsObserver(el) {
  if (!el || el.nodeType !== 1) return true;
  if (el.closest && el.closest('head')) return true;
  const tag = el.tagName;
  if (tag === 'STYLE' || tag === 'SCRIPT') return true;
  if (tag === 'LINK' && String(el.rel || '').toLowerCase() === 'stylesheet') return true;
  if (el.closest && el.closest('.siap-sticky-bar')) return true;
  if (el.id === 'siap-side-viewer' || (el.closest && el.closest('#siap-side-viewer'))) return true;
  if (
    (el.classList && el.classList.contains('siap-draft-btn')) ||
    (el.closest && el.closest('.siap-draft-btn'))
  ) {
    return true;
  }
  if (el.hasAttribute && el.hasAttribute('data-siap-extension-ui')) return true;
  if (el.closest && el.closest('[data-siap-extension-ui]')) return true;
  return false;
}

function siapDomChangeNodeIsRelevant(node) {
  if (!node) return false;
  if (node.nodeType === 3) {
    const p = node.parentElement;
    return !!(p && !siapNodeIgnorableForStatsObserver(p));
  }
  if (node.nodeType !== 1) return false;
  return !siapNodeIgnorableForStatsObserver(node);
}

/**
 * Ignora injeção de estilos, UI da extensão e nós fora do interesse do painel SIAP,
 * para não reagir a dezenas de mutações por segundo (ex.: timers, ASP.NET).
 */
function siapMutationsRelevantForPageStats(mutations) {
  if (!mutations || mutations.length === 0) return false;
  for (let i = 0; i < mutations.length; i++) {
    const m = mutations[i];
    if (m.type !== 'childList') continue;
    let j;
    for (j = 0; j < m.addedNodes.length; j++) {
      if (siapDomChangeNodeIsRelevant(m.addedNodes[j])) return true;
    }
    for (j = 0; j < m.removedNodes.length; j++) {
      if (siapDomChangeNodeIsRelevant(m.removedNodes[j])) return true;
    }
  }
  return false;
}

function siapObserveRootForStats() {
  const narrow =
    document.getElementById('ctl00_ctl00_cphFuncionalidade_cphCampos') ||
    document.getElementById('cphFuncionalidade_cphCampos');
  if (narrow instanceof HTMLElement) return narrow;
  const form = document.getElementById('aspnetForm') || document.getElementById('form1');
  if (form instanceof HTMLElement) return form;
  return document.body;
}

/**
 * Debounce no scrape+serialização antes de UPDATE_PAGE_STATS (CPU na aba).
 * immediate: primeira carga ou flush pós-ação crítica.
 */
function siapScheduleUpdatePageStatsFromDom(options) {
  const immediate = options && options.immediate === true;
  const run = () => {
    siapStatsPushTimer = null;
    const stats = getMissingClassesStats();
    if (!stats) return;
    try {
      const json = JSON.stringify(stats);
      if (json === siapStatsLastSentJson) return;
      siapStatsLastSentJson = json;
      safeSendMessage({ action: 'UPDATE_PAGE_STATS', stats });
    } catch (e) {
      console.warn('SIAP: falha ao serializar/enviar stats', e);
    }
  };
  if (immediate) {
    if (siapStatsPushTimer) {
      clearTimeout(siapStatsPushTimer);
      siapStatsPushTimer = null;
    }
    run();
    return;
  }
  if (siapStatsPushTimer) clearTimeout(siapStatsPushTimer);
  siapStatsPushTimer = setTimeout(run, SIAP_DOM_SCRAPE_DEBOUNCE_MS);
}

/**
 * Abre o modal do dia no calendário de planejamento.
 * Preferir targetDataCanonica (ex: "2026/5/4"); fallback: número do dia (legado).
 */
function enterPlanejamentoDay(targetDataCanonicaOrDay) {
  let diaTd = null;

  if (typeof targetDataCanonicaOrDay === 'string' && targetDataCanonicaOrDay.includes('/')) {
    const targetDataCanonica = targetDataCanonicaOrDay;
    console.log('SIAP: Buscando a data', targetDataCanonica, 'no calendário (data-canonica)...');
    diaTd = findClickablePlanningCellForCanon(targetDataCanonica);
    if (!diaTd) {
      console.log('SIAP: Data', targetDataCanonica, 'não encontrada (nem no td nem em filho).');
      return;
    }
  } else if (targetDataCanonicaOrDay != null && targetDataCanonicaOrDay !== '') {
    const targetDay = targetDataCanonicaOrDay;
    console.log('SIAP: Buscando o dia (legado)', targetDay, 'no calendário...');
    const tdDias = Array.from(document.querySelectorAll('td.letivo'));
    diaTd = tdDias.find(td => {
      const textNode = td.querySelector('div')?.childNodes[0];
      return textNode && String(textNode.nodeValue || '').trim() === String(targetDay);
    });
    if (!diaTd) {
      console.log('SIAP: Dia', targetDay, 'não encontrado no calendário da tela atual.');
      return;
    }
  } else {
    return;
  }

  console.log('SIAP: Célula encontrada! Clicando...');
  diaTd.click();
  
  // Lógica de espera do Modal
  let tentativas = 0;
  const checkModal = setInterval(() => {
    tentativas++;
    // Busca qualquer aula dentro do modal visível, seja ela planejada ou não
    const aulaBtnDialog = document.querySelector('.ui-dialog .naoPlanejada') || 
                          document.querySelector('.ui-dialog .planejada') ||
                          document.querySelector('.dialogSequencial:not([style*="display: none"]) .naoPlanejada') ||
                          document.querySelector('.dialogSequencial:not([style*="display: none"]) .planejada');
    
    if (aulaBtnDialog) {
      clearInterval(checkModal);
      console.log("SIAP: Modal aberto! Entrando na edição da aula...");
      aulaBtnDialog.click();
    } else if (tentativas > 20) {
      clearInterval(checkModal);
      console.log("SIAP: Timeout esperando o modal de Planejamento abrir.");
    }
  }, 200);
}

function initEdicaoPage() {
  console.log("SIAP: Iniciando módulo de Edição de Frequência.");
  
  const dateInput = document.getElementById('cphFuncionalidade_cphCampos_txtDataSelecionada');
  if (!dateInput || !dateInput.value.trim()) {
    const first = getFirstPendingDayEntry();
    if (first) {
      console.log('SIAP: [Auto-Select] Nenhum dia selecionado e há pendências. Auto-clicando no dia mais distante:', first);
      clickPendingCalendarCell(first);
      return; 
    }
  }
  
  siapScheduleUpdatePageStatsFromDom({ immediate: true });

  const observer = new MutationObserver((mutations) => {
    if (!siapMutationsRelevantForPageStats(mutations)) return;
    siapScheduleUpdatePageStatsFromDom({ immediate: false });
  });
  observer.observe(siapObserveRootForStats(), { childList: true, subtree: true });


  if (sessionStorage.getItem('siap_next_day_intent')) {
    sessionStorage.removeItem('siap_next_day_intent');
    const months = getPendingDays();
    const flat = [];
    months.forEach(m => (m.days || []).forEach(d => flat.push(typeof d === 'number' ? { day: d, dataCanonica: null } : d)));
    const first = flat.sort((a, b) => {
      if (a.dataCanonica && b.dataCanonica) {
        const pa = a.dataCanonica.split('/').map(x => parseInt(String(x).trim(), 10));
        const pb = b.dataCanonica.split('/').map(x => parseInt(String(x).trim(), 10));
        return new Date(pa[0], pa[1] - 1, pa[2]) - new Date(pb[0], pb[1] - 1, pb[2]);
      }
      return a.day - b.day;
    })[0];
    if (first) {
      setTimeout(function() {
        if (first.dataCanonica) {
          const td = findClickablePlanningCellForCanon(first.dataCanonica);
          if (td) {
            td.click();
            td.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
          }
          return;
        }
        const nextDay = String(first.day);
        const tds = Array.from(document.querySelectorAll('td.letivo, table td'));
        const dayCell = tds.find(td => {
          const text = td.innerText.trim();
          return text === nextDay || text === '0' + nextDay;
        });
        if (dayCell) {
          dayCell.click();
          dayCell.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
        }
      }, 500);
    }
  }

  getQueue().then(queue => {
    if (queue.length > 0) setTimeout(processNextTask, 1500);
  });
}

/**
 * Smart Geminada: Ao carregar a página de conteúdo, verifica se a aula ATUAL já
 * está preenchida. Se sim (e houver próximas aulas no dropdown), avança automaticamente
 * antes de notificar o Mobile — assim o professor só vê a aula que ainda precisa preencher.
 * Suporta N aulas (não só 2): percorre até encontrar uma vazia ou esgotar as opções.
 */
function initConteudoPage() {
  const ddAula = document.getElementById('cphFuncionalidade_cphCampos_LstAulasDiaSelecionado');
  const totalAulas = ddAula && ddAula.options ? ddAula.options.length : 0;

  console.log('[SIAP GEMINADA DEBUG] initConteudoPage chamado');
  console.log('[SIAP GEMINADA DEBUG] Total aulas no dropdown:', totalAulas);
  console.log('[SIAP GEMINADA DEBUG] SelectedIndex:', ddAula ? ddAula.selectedIndex : 'N/A');
  console.log('[SIAP GEMINADA DEBUG] URL:', window.location.href);
  console.log('[SIAP GEMINADA DEBUG] Delay 1500ms antes de verificar preenchimento...');

  setTimeout(() => {
    const dd = document.getElementById('cphFuncionalidade_cphCampos_LstAulasDiaSelecionado');
    const totalAulas2 = dd && dd.options ? dd.options.length : 0;
    console.log('[SIAP GEMINADA DEBUG] Após 1500ms — total aulas:', totalAulas2);
    console.log('[SIAP GEMINADA DEBUG] Após 1500ms — aula atual text:', dd && dd.options && dd.options[dd.selectedIndex] ? dd.options[dd.selectedIndex].text : 'N/A');

    // Verificação extra: se o SIAP ainda está carregando a grade
    const grdPlanejado = document.getElementById('cphFuncionalidade_cphCampos_grdPlanejado');
    console.log('[SIAP GEMINADA DEBUG] Grade (grdPlanejado) existe:', !!grdPlanejado);
    if (grdPlanejado) {
      const rows = grdPlanejado.querySelectorAll('tr');
      console.log('[SIAP GEMINADA DEBUG] Linhas na grade:', rows.length);
    }

    if (totalAulas2 > 1 && siapAulaJaPreenchida()) {
      // Aula atual preenchida — tenta avançar para a próxima
      console.log('[SIAP GEMINADA DEBUG] Aula atual está PREENCHIDA — tentando avançar...');
      const avancou = siapAvancarParaProximaAula(dd);
      if (avancou) {
        // O PostBack vai recarregar a página na próxima aula; aguarda reload.
        console.log('[SIAP GEMINADA DEBUG] Avançou! Aguardando reload para próxima aula...');
        console.log('[SIAP GEMINADA DEBUG] initConteudoPage ABORTADO (reload pendente)');
        return;
      }
      // Não tem próxima aula — todas preenchidas; segue fluxo normal
      console.log('[SIAP GEMINADA DEBUG] Todas as aulas preenchidas — seguindo fluxo normal');
    } else {
      if (totalAulas2 <= 1) {
        console.log('[SIAP GEMINADA DEBUG] Apenas 1 aula ou nenhuma — pulando verificação geminada');
      } else {
        console.log('[SIAP GEMINADA DEBUG] Aula atual está VAZIA — pode injetar conteúdo');
      }
    }

    // Aula atual está vazia (ou é a única) — inicializa normalmente
    initConteudoPagePostGeminada();
  }, 1500);
}

function initConteudoPagePostGeminada() {
  const dateInput = document.getElementById('cphFuncionalidade_cphCampos_txtDataSelecionada');
  const ddAula = document.getElementById('cphFuncionalidade_cphCampos_LstAulasDiaSelecionado');

  console.log('[SIAP GEMINADA DEBUG] initConteudoPagePostGeminada chamado');
  console.log('[SIAP GEMINADA DEBUG] Data selecionada:', dateInput ? dateInput.value : 'N/A');
  console.log('[SIAP GEMINADA DEBUG] Dropdown aulas: total=' + (ddAula ? ddAula.options.length : 0) + ' | selectedIndex=' + (ddAula ? ddAula.selectedIndex : 'N/A'));

  if (!dateInput || !dateInput.value.trim()) {
    const first = getFirstPendingDayEntry();
    if (first) {
      console.log('[SIAP GEMINADA DEBUG] [Auto-Select] Nenhum dia selecionado e há pendências. Auto-clicando no dia mais distante:', first);
      clickPendingCalendarCell(first);
      return;
    }
  }

  siapScheduleUpdatePageStatsFromDom({ immediate: true });

  const observer = new MutationObserver((mutations) => {
    if (!siapMutationsRelevantForPageStats(mutations)) return;
    siapScheduleUpdatePageStatsFromDom({ immediate: false });
  });
  observer.observe(siapObserveRootForStats(), { childList: true, subtree: true });

  // Auto-avanço pós-salvamento (vinculado ao mobile)
  trySiapAvancarAposSalvarFromConteudoInit();
}

// --- DraftGuardian: Auto-Save & Restoration ---
const DRAFT_PREFIX = "siap_draft_";

function initDraftGuardian() {
  console.log("SIAP: [DraftGuardian] Iniciado.");

  const getElementKey = (el) => {
    const path = window.location.pathname.replace(/\//g, '_');
    const id = el.id || el.name || "unnamed";
    return `${DRAFT_PREFIX}${path}_${id}`;
  };

  let debounceTimer;
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const key = getElementKey(el);
        if (el.value.trim().length > 3) {
          chrome.storage.local.set({ [key]: el.value });
        } else {
          chrome.storage.local.remove(key);
        }
      }, 1000);
    }
  });

  // Inject restoration UI
  const checkAndInjectRestoration = () => {
    const inputs = document.querySelectorAll('textarea, input[type="text"]');
    inputs.forEach(async (el) => {
      // Don't inject if already has value or already has button
      if (el.value.trim().length > 0 || el.parentElement.querySelector('.siap-draft-btn')) return;

      const key = getElementKey(el);
      chrome.storage.local.get([key], (result) => {
        const savedValue = result[key];
        if (savedValue && savedValue.trim().length > 0) {
          injectRestorationButton(el, savedValue, key);
        }
      });
    });
  };

  function injectRestorationButton(el, value, key) {
    const btn = document.createElement('div');
    btn.className = 'siap-draft-btn';
    btn.innerHTML = `🛡️ SIAP Frequência detectou um rascunho salvo. <span style="text-decoration: underline; font-weight: bold;">Clique para restaurar.</span>`;
    btn.style.cssText = `
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #f59e0b;
      padding: 8px 12px;
      margin-bottom: 5px;
      border-radius: 8px;
      font-size: 11px;
      cursor: pointer;
      display: inline-block;
      animation: bounceIn 0.5s ease;
    `;

    btn.onclick = () => {
      el.value = value;
      el.style.border = '2px solid #10b981';
      el.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.4)';
      btn.remove();
      setTimeout(() => {
        el.style.border = '';
        el.style.boxShadow = '';
      }, 3000);
    };

    el.parentNode.insertBefore(btn, el);
  }

  // Clear drafts on submit
  document.addEventListener('click', (e) => {
    if (e.target.type === 'submit' || e.target.id?.toLowerCase().includes('btn') || e.target.value?.toLowerCase().includes('salvar')) {
       // A smarter approach would be to clear specific drafts after a fetch/redirect, 
       // but for now we clear on submit attempts.
       // chrome.storage.local.remove(...)
    }
  });

  const observer = new MutationObserver(checkAndInjectRestoration);
  observer.observe(document.body, { childList: true, subtree: true });
  checkAndInjectRestoration();
}

// Add animation
const style = document.createElement('style');
style.innerHTML = `
  @keyframes bounceIn {
    0% { transform: scale(0.9); opacity: 0; }
    50% { transform: scale(1.05); }
    100% { transform: scale(1); opacity: 1; }
  }
`;
document.head.appendChild(style);

// Side Viewer Implementation
let viewerContainer = null;
let viewerImages = [];
let viewerIdx = 0;

function toggleSideViewer(images) {
  if (viewerContainer) {
    viewerContainer.remove();
    viewerContainer = null;
    return;
  }
  
  if (!images || images.length === 0) return;
  viewerImages = images;
  viewerIdx = 0;
  
  viewerContainer = document.createElement('div');
  viewerContainer.id = 'siap-side-viewer';
  viewerContainer.style.cssText = `
    position: fixed;
    top: 0;
    right: 320px; /* Sidebar width + gap */
    width: 700px;
    height: 100vh;
    background: rgba(0,0,0,0.85);
    z-index: 9999999;
    display: flex;
    flex-direction: column;
    box-shadow: -5px 0 15px rgba(0,0,0,0.3);
    border-left: 2px solid #f59e0b;
    color: white;
    font-family: sans-serif;
    transition: transform 0.3s ease;
  `;
  
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #1f2937;
    font-size: 12px;
    font-weight: bold;
    border-bottom: 1px solid #374151;
  `;
  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:15px;">
      <span>VISUALIZADOR DE CHAMADAS</span>
      <div style="display:flex;gap:5px;">
        <button id="zoom-out-siap" style="background:#374151;border:none;color:white;width:24px;height:24px;border-radius:4px;cursor:pointer;font-weight:bold;">-</button>
        <button id="zoom-in-siap" style="background:#374151;border:none;color:white;width:24px;height:24px;border-radius:4px;cursor:pointer;font-weight:bold;">+</button>
        <button id="zoom-reset-siap" style="background:#374151;border:none;color:white;padding:0 8px;height:24px;border-radius:4px;cursor:pointer;font-size:10px;">Reset</button>
      </div>
    </div>
    <button id="close-siap-viewer" style="background:none;border:none;color:white;cursor:pointer;font-size:16px;">&times;</button>
  `;
  
  const imgContainer = document.createElement('div');
  imgContainer.id = 'siap-img-container';
  imgContainer.style.cssText = `
    flex: 1;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    position: relative;
    cursor: grab;
  `;
  
  const img = document.createElement('img');
  img.id = 'siap-viewer-img';
  img.src = viewerImages[0];
  img.style.cssText = `
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    transition: transform 0.1s ease-out;
    transform-origin: center;
    user-select: none;
    -webkit-user-drag: none;
  `;
  imgContainer.appendChild(img);
  
  const footer = document.createElement('div');
  footer.style.cssText = `
    padding: 15px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #111827;
  `;
  
  footer.innerHTML = `
    <button id="prev-siap-img" style="background:#374151;border:none;color:white;padding:8px 15px;border-radius:8px;cursor:pointer;">&larr; Anterior</button>
    <span id="siap-viewer-count">1 / ${viewerImages.length}</span>
    <button id="next-siap-img" style="background:#374151;border:none;color:white;padding:8px 15px;border-radius:8px;cursor:pointer;">Próxima &rarr;</button>
  `;
  
  viewerContainer.appendChild(header);
  viewerContainer.appendChild(imgContainer);
  viewerContainer.appendChild(footer);
  
  document.body.appendChild(viewerContainer);
  
  // Events
  document.getElementById('close-siap-viewer').onclick = () => toggleSideViewer();
  document.getElementById('prev-siap-img').onclick = () => {
    viewerIdx = (viewerIdx - 1 + viewerImages.length) % viewerImages.length;
    updateViewer();
  };
  document.getElementById('next-siap-img').onclick = () => {
    viewerIdx = (viewerIdx + 1) % viewerImages.length;
    updateViewer();
  };
  
  document.getElementById('zoom-in-siap').onclick = () => {
    scale *= 1.4;
    if (scale > 10) scale = 10;
    setTransform();
  };
  document.getElementById('zoom-out-siap').onclick = () => {
    scale /= 1.4;
    if (scale < 0.2) scale = 0.2;
    setTransform();
  };
  document.getElementById('zoom-reset-siap').onclick = () => resetZoom();
}

function updateViewer() {
  const img = document.getElementById('siap-viewer-img');
  const count = document.getElementById('siap-viewer-count');
  if (img && count) {
    img.src = viewerImages[viewerIdx];
    count.innerText = `${viewerIdx + 1} / ${viewerImages.length}`;
    resetZoom();
  }
}

let scale = 1;
let pointX = 0;
let pointY = 0;
let start = { x: 0, y: 0 };
let isDragging = false;

function setTransform() {
  const img = document.getElementById('siap-viewer-img');
  if (img) {
    img.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
  }
}

function resetZoom() {
  scale = 1;
  pointX = 0;
  pointY = 0;
  setTransform();
}

// Add event listeners for zoom/pan
document.addEventListener('wheel', (e) => {
  const container = document.getElementById('siap-img-container');
  if (!container || !container.contains(e.target)) return;
  
  e.preventDefault();
  const xs = (e.clientX - pointX) / scale;
  const ys = (e.clientY - pointY) / scale;
  const delta = -e.deltaY;
  
  (delta > 0) ? (scale *= 1.2) : (scale /= 1.2);
  if (scale < 0.5) scale = 0.5;
  if (scale > 10) scale = 10;
  
  // Update pointX/Y to zoom towards cursor (approximation for simple viewer)
  setTransform();
}, { passive: false });

document.addEventListener('mousedown', (e) => {
  const container = document.getElementById('siap-img-container');
  if (!container || !container.contains(e.target)) return;
  
  e.preventDefault();
  start = { x: e.clientX - pointX, y: e.clientY - pointY };
  isDragging = true;
  container.style.cursor = 'grabbing';
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  e.preventDefault();
  pointX = e.clientX - start.x;
  pointY = e.clientY - start.y;
  setTransform();
});

document.addEventListener('mouseup', () => {
  isDragging = false;
  const container = document.getElementById('siap-img-container');
  if (container) container.style.cursor = 'grab';
});

// --- Page: DiarioEscolarListagem.aspx ---

const FILTERS_STORAGE_KEY = "siap_default_filters";
const FILTERS_PROGRESS_KEY = "siap_filters_applying";

function initListagemPage() {
  console.log("SIAP: [DEBUG] Módulo de Listagem Sticky Bar carregado.");

  let isProcessing = false;
  let mutationTimeout;

  const getOrCreateStickyBar = () => {
    let bar = document.querySelector('.siap-sticky-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'siap-sticky-bar';
      bar.style.cssText = `
        position: sticky; top: 0; z-index: 10000; background: rgba(255, 255, 255, 1);
        border-bottom: 2px solid #2563eb; padding: 8px 16px; display: flex;
        flex-wrap: wrap; align-items: center; gap: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        min-height: 50px;
      `;
      document.body.prepend(bar);
      
      const leftSection = document.createElement('div');
      leftSection.className = 'siap-section-filters';
      leftSection.style.cssText = 'display: flex; gap: 8px; align-items: center;';
      bar.appendChild(leftSection);
    }
    return bar;
  };

  const getSelects = () => {
    const selectors = {
      composicao: 'ddlComposicao',
      serie: 'ddlSerie',
      bimestre: 'ddlBimestre',
      turno: 'ddlTurno',
      componente: 'ddlDisciplina'
    };
    const elements = {};
    const allSelects = Array.from(document.querySelectorAll('select'));
    Object.entries(selectors).forEach(([key, pattern]) => {
      elements[key] = allSelects.find(s => s.id.includes(pattern) || s.name?.includes(pattern));
    });
    return elements;
  };

  const saveFilters = async () => {
    const filterValues = {};
    Object.entries(getSelects()).forEach(([key, el]) => { if (el) filterValues[key] = el.value; });
    if (chrome?.storage?.local) {
      await chrome.storage.local.set({ [FILTERS_STORAGE_KEY]: filterValues });
      alert("⭐ Filtros favoritados!");
    }
  };

  const applyFilters = async () => {
    chrome.storage.local.get([FILTERS_STORAGE_KEY], (result) => {
      const saved = result[FILTERS_STORAGE_KEY];
      if (!saved) return;
      sessionStorage.setItem(FILTERS_PROGRESS_KEY, "true");
      const selects = getSelects();
      for (const [key, val] of Object.entries(saved)) {
        const el = selects[key];
        if (el && val && el.value !== val) {
          el.value = val;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
      sessionStorage.removeItem(FILTERS_PROGRESS_KEY);
      const listBtn = document.querySelector('input[value*="Listar"]') || 
                      Array.from(document.querySelectorAll('input, button')).find(el => (el.value || el.innerText || "").includes('Listar'));
      if (listBtn) listBtn.click();
    });
  };

  const injectFilterUI = () => {
    const bar = getOrCreateStickyBar();
    const container = bar.querySelector('.siap-section-filters');
    if (container.children.length > 0) return;

    const saveBtn = document.createElement('button');
    saveBtn.innerText = '⭐ Salvar Filtros';
    saveBtn.style.cssText = 'background: #f8fafc; color: #475569; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; white-space: nowrap;';
    saveBtn.onclick = (e) => { e.preventDefault(); saveFilters(); };
    container.appendChild(saveBtn);

    chrome.storage.local.get([FILTERS_STORAGE_KEY], (result) => {
      const hasSaved = !!result[FILTERS_STORAGE_KEY];
      const useBtn = document.createElement('button');
      useBtn.innerText = '⚡ Aplicar Favorito';
      useBtn.style.cssText = hasSaved ? 'background: #2563eb; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; white-space: nowrap;' : 'background: #e2e8f0; color: #94a3b8; border: none; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: not-allowed; white-space: nowrap;';
      if (hasSaved) useBtn.onclick = (e) => { e.preventDefault(); applyFilters(); };
      container.appendChild(useBtn);
    });
  };

  const findListingTable = () => {
    const tables = Array.from(document.querySelectorAll('table'));
    for (const table of tables) {
      if (table.rows.length < 2) continue;
      for (let i = 0; i < Math.min(table.rows.length, 3); i++) {
        const text = table.rows[i].innerText.toLowerCase();
        const hasTurma = text.includes('turma');
        const hasComp = text.includes('composição') || text.includes('composicao') || text.includes('componente') || text.includes('disciplina');
        if (hasTurma && hasComp) {
          return { table, headerRow: i };
        }
      }
    }
    return null;
  };

  const scrapeTableData = () => {
    const found = findListingTable();
    if (!found) return null;
    const { table, headerRow } = found;

    const headers = Array.from(table.rows[headerRow].cells).map(c => c.innerText.toLowerCase());
    const compIdx = headers.findIndex(h => h.includes('componente') || h.includes('disciplina'));
    const turmaIdx = headers.findIndex(h => h.includes('turma'));
    
    if (compIdx === -1 || turmaIdx === -1) return null;

    const map = {};
    Array.from(table.rows).slice(headerRow + 1).forEach((row) => {
      if (row.cells.length <= Math.max(compIdx, turmaIdx)) return;
      const disc = row.cells[compIdx].innerText.trim();
      const name = row.cells[turmaIdx].innerText.trim();
      if (disc.length < 3 || name.length === 0 || name.length > 10) return;
      if (!map[disc]) map[disc] = [];
      if (!map[disc]) map[disc] = [];
      map[disc].push({ name, rowIndex: row.rowIndex });
    });
    return map;
  };

  const dispatchDashboardData = () => {
    syncSiapUserProfileToStorage();
    const data = scrapeTableData();
    if (data && chrome?.storage?.local) {
      chrome.storage.local.set({ siap_classes_data: data });
    }
  };

  const processIntent = () => {
    const intentStr = sessionStorage.getItem('siap_intent');
    if (!intentStr) return;
    
    try {
      const intent = JSON.parse(intentStr);
      const found = findListingTable();
      
      if (!found) {
        // If table not found, try to click Listar to generate it
        const listBtn = document.querySelector('input[value*="Listar"]') || 
                        Array.from(document.querySelectorAll('input, button')).find(el => (el.value || el.innerText || "").includes('Listar'));
        if (listBtn) {
          console.log("SIAP: Intent pendente, clicando em Listar...");
          listBtn.click();
        }
        return;
      }

      const row = found.table.rows[intent.rowIndex];
      if (row) {
        // We only remove the intent after we're sure we've triggered the final action
        // or if we're in a state where we can't continue.
        const radio = row.querySelector('input[type="radio"]');
        
        // If the radio is already checked, just proceed to click the action button
        if (radio && radio.checked) {
          triggerActionBtn(intent.action);
        } else {
          // Click and wait to see if it triggers a postback
          if (radio) radio.click(); else row.click();
          
          // Wait for a possible postback. If the page reloads, this script instance dies.
          // If it doesn't reload, we trigger the button after a delay.
          setTimeout(() => {
            triggerActionBtn(intent.action);
          }, 800);
        }
      }
    } catch (e) {
      console.error("SIAP: Erro ao processar intent:", e);
      sessionStorage.removeItem('siap_intent');
    }
  };

  const triggerActionBtn = (actionLabel) => {
    const label = actionLabel.toLowerCase().trim();
    let actionBtn;
    
    const allButtons = Array.from(document.querySelectorAll('input[type="submit"], input[type="button"], button'));
    
    if (label.includes('frequência')) {
      actionBtn = document.getElementById('cphFuncionalidade_btnAuxiliar2') || 
                  allButtons.find(el => {
                    const txt = (el.value || el.innerText || "").toLowerCase();
                    return txt === 'frequência' || txt === 'frequencia' || txt.includes('lançar frequência');
                  });
    } else if (label.includes('conteúdo')) {
      // Prioritize Content/Planning buttons
      actionBtn = allButtons.find(el => {
        const txt = (el.value || el.innerText || "").toLowerCase();
        return txt === 'conteúdos' || txt === 'conteudo' || txt === 'conteúdo' || txt.includes('planejamento');
      }) || document.getElementById('cphFuncionalidade_btnAuxiliar');
    } else if (label.includes('nota')) {
      actionBtn = document.getElementById('cphFuncionalidade_btnAuxiliar3') || 
                  allButtons.find(el => (el.value || el.innerText || "").toLowerCase().includes('notas'));
    } else if (label.includes('acesso')) {
      actionBtn = document.getElementById('cphFuncionalidade_btnAuxiliar4') || 
                  allButtons.find(el => (el.value || el.innerText || "").toLowerCase().includes('acesso remoto'));
    } else if (label.includes('planejamento')) {
      // Prioridade absoluta para o botão 'Visualizar' (btnEditar) na listagem de planos
      actionBtn = document.getElementById('cphFuncionalidade_btnEditar') || 
                  allButtons.find(el => {
                    const txt = (el.value || el.innerText || "").toLowerCase();
                    const id = (el.id || "").toLowerCase();
                    return txt === 'visualizar' || id.includes('btnvisualizar') || id.includes('btneditar');
                  });
    }
    
    if (actionBtn) {
      console.log("SIAP: Intent executado, clicando em " + label);
      
      // Se for planejamento, salvar intenção extra para disparar o caçador de dias na próxima página
      if (label.toLowerCase().includes('planejamento')) {
        sessionStorage.setItem('siap_planejamento_intent', 'true');
      }

      sessionStorage.removeItem('siap_intent'); // Consumed successfully
      actionBtn.click();
    }
  };
  const observer = new MutationObserver((muts) => {
    if (isProcessing) return;
    const isOur = muts.some(m => m.target && m.target.closest && (m.target.closest('.siap-sticky-bar')));
    if (isOur) return;
    if (!siapMutationsRelevantForPageStats(muts)) return;

    clearTimeout(mutationTimeout);
    mutationTimeout = setTimeout(() => {
      dispatchDashboardData();
      injectFilterUI();
      processIntent();
    }, SIAP_DOM_SCRAPE_DEBOUNCE_MS);
  });

  observer.observe(siapObserveRootForStats(), { childList: true, subtree: true });
  injectFilterUI();
  dispatchDashboardData();
  processIntent();
  if (sessionStorage.getItem(FILTERS_PROGRESS_KEY)) applyFilters();
}

// --- Inspector Tool ---

function initInspector() {
  const btn = document.createElement('button');
  btn.setAttribute('data-siap-extension-ui', 'inspector');
  btn.innerText = '🔍';
  btn.style.cssText = 'position: fixed; bottom: 10px; right: 10px; z-index: 999999; background: #f87171; color: white; width: 30px; height: 30px; border-radius: 50%; border: none; font-size: 12px; cursor: pointer; opacity: 0.5;';
  btn.onclick = async () => {
    const els = Array.from(document.querySelectorAll('select, input, button')).map(el => ({ tag: el.tagName, id: el.id, value: el.value }));
    await navigator.clipboard.writeText(JSON.stringify(els));
    alert('OK');
  };
  document.body.appendChild(btn);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("SIAP: Mensagem recebida:", message.action);
  
  if (message.action === "REQUEST_PAGE_STATS") {
    sendResponse({ stats: getMissingClassesStats() });
  } else if (message.action === "ADD_TO_QUEUE" && message.payload && Array.isArray(message.payload)) {
    // Detecta se o salvamento foi solicitado para autorizar o auto-avanço pós-refresh
    const hasSaveBtn = message.payload.some(item => 
      item === 'cphFuncionalidade_btnAlterar' || 
      (typeof item === 'string' && (item.includes('btnAlterar') || item.includes('btnSalvar')))
    );
    if (hasSaveBtn) {
      console.log("SIAP: [Avançar pós-salvar] Salvamento detectado na fila. Auto-avanço pré-autorizado.");
      sessionStorage.setItem(SIAP_AVANCAR_APOS_SALVAR_KEY, 'true');
    }

    localStorage.setItem(QUEUE_KEY, JSON.stringify(message.payload));
    if (message.treePostBackTarget) {
      localStorage.setItem('siap_tree_postback_target', message.treePostBackTarget);
    }

    // --- Lógica de Presets de Materiais (Cache) ---
    const path = window.location.pathname.toLowerCase();
    if (path.includes("conteudoprogramaticoedicao.aspx")) {
      const turmaInput = document.getElementById('cphFuncionalidade_cphCampos_txtTurma');
      const turma = turmaInput ? turmaInput.value.trim() : null;
      if (turma) {
        // Mapeia btnIds selecionados de volta para os textos dos materiais
        const materialTable = document.getElementById('cphFuncionalidade_cphCampos_GrdMaterialApoio');
        if (materialTable) {
          const materiaisRows = materialTable.querySelectorAll('tbody tr:not(:first-child)');
          const selectedMaterialTexts = [];
          materiaisRows.forEach(row => {
            const descSpan = row.querySelector('.descricao-item-grade');
            const submitBtn = row.querySelector('input[type="submit"]');
            if (descSpan && submitBtn && message.payload.includes(submitBtn.id)) {
              selectedMaterialTexts.push(descSpan.innerText.trim());
            }
          });
          
          if (selectedMaterialTexts.length > 0) {
            localStorage.setItem(`siap_preset_mat_${turma}`, JSON.stringify(selectedMaterialTexts));
            console.log(`SIAP: [Cache] Salvando ${selectedMaterialTexts.length} presets de materiais para a turma ${turma}`);
          }
        }
      }
    }
    // ----------------------------------------------

    console.log("SIAP: Nova fila recebida com", message.payload.length, "itens.", message.treePostBackTarget ? '(TreeView)' : '');
    // Garante que o poller pode começar a trabalhar e reseta o contador total
    isProcessing = false;
    totalItemsInQueue = message.payload.length;
    
    // Feedback imediato de 0%
    safeSendMessage({ 
      action: "QUEUE_PROGRESS", 
      payload: { current: 0, total: totalItemsInQueue } 
    });

    sendResponse({ success: true });
  } else if ((message.action === "LANCAR_FALTAS" || message.action === "ADD_TO_QUEUE_LEGACY") && Array.isArray(message.numbers || message.tasks)) {
    const items = message.numbers || message.tasks;
    saveQueue(items).then(() => {
      processNextTask();
    });
    sendResponse({ success: true });
  } else if (message.action === "TOGGLE_SIDE_VIEWER") {
    if (typeof toggleSideViewer === 'function') toggleSideViewer(message.images);
    sendResponse({ success: true });
  } else if (message.action === "MARK_STUDENT_ABSENT" || message.action === "UNMARK_STUDENT_ABSENT") {
    // Shared student mark logic
    handleStudentAction(message);
    sendResponse({ success: true });
  } else if (message.action === 'ENTER_PLANEJAMENTO_DAY') {
    if (typeof enterPlanejamentoDay === 'function') {
      if (message.dataCanonica) enterPlanejamentoDay(message.dataCanonica);
      else enterPlanejamentoDay(message.payload);
    }
    sendResponse({ success: true });
  } else if (message.action === "SAVE_AND_NEXT_DAY") {
    const saveBtn = document.getElementById('cphFuncionalidade_btnAlterar');
    if (saveBtn) {
      sessionStorage.setItem('siap_next_day_intent', 'true');
      saveBtn.click();
    }
    sendResponse({ success: true });
  } else if (message.action === 'MUDAR_MES') {
    console.log('[SIAP] Executando PostBack manual imune ao CSP...');
    var isPrev = String(message.direcao || '').trim() === 'anterior';
    var isNext = String(message.direcao || '').trim() === 'proximo';
    if (!isPrev && !isNext) {
      console.warn('SIAP: MUDAR_MES — direção inválida:', message.direcao);
      sendResponse({ success: false });
      return;
    }

    var theForm = document.getElementById('aspnetForm') || document.forms[0];
    if (!theForm) {
      console.error('[SIAP] Formulário não encontrado.');
      sendResponse({ success: false });
      return;
    }

    var targetInput = document.getElementById('__EVENTTARGET');
    var argInput = document.getElementById('__EVENTARGUMENT');

    if (!targetInput) {
      targetInput = document.createElement('input');
      targetInput.type = 'hidden';
      targetInput.name = '__EVENTTARGET';
      targetInput.id = '__EVENTTARGET';
      theForm.appendChild(targetInput);
    }
    if (!argInput) {
      argInput = document.createElement('input');
      argInput.type = 'hidden';
      argInput.name = '__EVENTARGUMENT';
      argInput.id = '__EVENTARGUMENT';
      theForm.appendChild(argInput);
    }

    if (isPrev) {
      targetInput.value = 'cphFuncionalidade_cphMesAnterior_CalendarioMensal';
      argInput.value = 'a';
    } else {
      targetInput.value = 'cphFuncionalidade_cphMesSeguinte_CalendarioMensal';
      argInput.value = 's';
    }

    theForm.submit();
    sendResponse({ success: true });
    return;
  } else if (message.action === "SELECT_CALENDAR_DAY") {
    if (message.dataCanonica) {
      const tdCanon = findClickablePlanningCellForCanon(message.dataCanonica);
      console.log(`SIAP [Action]: Clique por data-canonica="${message.dataCanonica}"`);
      if (tdCanon) {
        const clickable = tdCanon.querySelector('a') || tdCanon;
        clickable.click();
        clickable.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
        return sendResponse({ success: true });
      }
      console.warn('SIAP: data-canonica não encontrada:', message.dataCanonica);
      return sendResponse({ success: false, error: 'data-canonica não encontrada' });
    }

    const targetDay = (message.payload || message.day || "").toString();
    const targetMonth = message.month;
    const targetYear = message.year;

    console.log(`SIAP [Action]: Comandando clique no dia ${targetDay} (Mês: ${targetMonth}, Ano: ${targetYear})`);
    
    if (!targetDay) {
      console.warn("SIAP: Chamado SELECT_CALENDAR_DAY sem dia definido.");
      return sendResponse({ success: false });
    }

    let searchScope = document.body;

    // Se informamos mês/ano, tentamos restringir a busca ao container correto
    if (targetMonth) {
      const monthNames = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
      const targetName = monthNames[targetMonth].toLowerCase();
      
      const containers = Array.from(document.querySelectorAll('table, .calendario, .container-mes, div'));
      const activeContainer = containers.find(c => {
        const text = (c.innerText + " " + (c.previousElementSibling?.innerText || "")).toLowerCase();
        return text.includes(targetName) && (!targetYear || text.includes(targetYear.toString()));
      });

      if (activeContainer) {
        console.log(`SIAP [Selector]: Localizado container para o mês ${targetName}`);
        searchScope = activeContainer;
      }
    }


    const cells = Array.from(searchScope.querySelectorAll('td.letivo, td.calendario-dia, table td'));
    const targetCell = cells.find(td => {
      const text = td.innerText.trim();
      return text === targetDay || text === '0' + targetDay;
    });

    if (targetCell) {
      const clickable = targetCell.querySelector('a') || targetCell;
      clickable.click();
      clickable.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
      sendResponse({ success: true });
    } else {
      console.warn(`SIAP [Selector]: Célula do dia ${targetDay} não encontrada.`);
      sendResponse({ success: false, error: "Célula não encontrada" });
    }

  } else if (message.action === "CHANGE_UNIDADE_TEMATICA") {
    const val = message.payload != null ? String(message.payload) : '';
    const eixoSelect =
      document.getElementById('ddlEixo') ||
      document.getElementById('cphFuncionalidade_cphCampos_ddlEixo') ||
      document.querySelector('select[id$="ddlEixo"]');
    const postbackTarget = 'ctl00$ctl00$cphFuncionalidade$cphCampos$ddlEixo';
    if (eixoSelect && val !== '' && eixoSelect.value !== val) {
      console.log('SIAP: Trocando Unidade Temática para', val);
      eixoSelect.value = val;
      safeDoPostBack(postbackTarget, '');

      // Polling pós-postback (UpdatePanel ou recarga parcial): re-envia stats até confirmar ou timeout.
      let attempts = 0;
      const maxAttempts = 20;
      const pollInterval = setInterval(() => {
        attempts++;
        siapScheduleUpdatePageStatsFromDom({ immediate: false });
        const currentEixo =
          document.getElementById('ddlEixo') ||
          document.getElementById('cphFuncionalidade_cphCampos_ddlEixo') ||
          document.querySelector('select[id$="ddlEixo"]');
        const currentVal = currentEixo ? String(currentEixo.value) : null;
        if (currentVal === val || attempts >= maxAttempts) {
          clearInterval(pollInterval);
          siapScheduleUpdatePageStatsFromDom({ immediate: true });
          if (currentVal === val) {
            console.log('SIAP: [EixoPoll] Sincronização confirmada para', val);
          } else {
            console.warn('SIAP: [EixoPoll] Esgotado sem confirmar', val);
          }
        }
      }, 800);
    }
    sendResponse({ success: true });
  } else if (message.action === "ENTER_PLANEJAMENTO") {
    enterNextPlanejamento();
    sendResponse({ success: true });
  }
  return true;
});

function handleStudentAction(message) {
  const matricula = message.matricula;
  const studentName = message.name;
  const studentNumber = message.number;
  const shouldMark = message.action === "MARK_STUDENT_ABSENT";

  const dateInput = document.getElementById('cphFuncionalidade_cphCampos_txtDataSelecionada');
  const currentDate = dateInput ? dateInput.value : null;

  let targetItem = null;

  if (currentDate) {
    const columns = Array.from(document.querySelectorAll('.listaDeFrequencias'));
    const activeColumn = columns.find(col => col.getAttribute('data-data') === currentDate);
    if (activeColumn) {
      targetItem = activeColumn.querySelector(`.item[data-matricula="${matricula}"]`);
    }
  }

  if (!targetItem) {
    const items = Array.from(document.querySelectorAll('.listaDeFrequencias .item, tr, .item'));
    targetItem = items.find(el => {
      const rowText = el.closest('tr, .item-container, body')?.innerText || "";
      return el.getAttribute('data-matricula') === matricula || 
             (rowText.includes(studentNumber + '.') && rowText.includes(studentName));
    });
  }

  if (targetItem) {
    targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const isAbsent = targetItem.innerText.trim() === 'F' || targetItem.classList.contains('ausente');
    
    if (shouldMark && !isAbsent) {
      targetItem.click();
    } else if (!shouldMark && isAbsent) {
      targetItem.click();
    }
    
    const input = targetItem.querySelector('input[type="checkbox"], input[type="text"]');
    if (input) {
      if (input.type === "checkbox") {
        if (shouldMark && !input.checked) input.click();
        else if (!shouldMark && input.checked) input.click();
      } else if (input.type === "text") {
        input.value = shouldMark ? "F" : "";
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }
}

function initLoginPage() {
  // Página de login: não dispara LOGGED_IN nem syncSiapUserProfileToStorage (usuário ainda não autenticado).
  console.log("SIAP: Módulo ativo na página de login.");
}

function initPlanejamentoPage() {
  console.log("SIAP: Módulo de Calendário de Planejamento Ativo.");
  
  siapScheduleUpdatePageStatsFromDom({ immediate: true });

  const observer = new MutationObserver((mutations) => {
    if (!siapMutationsRelevantForPageStats(mutations)) return;
    siapScheduleUpdatePageStatsFromDom({ immediate: false });
  });
  observer.observe(siapObserveRootForStats(), { childList: true, subtree: true });

  // Auto-Start: REMOVIDO para dar controle ao professor
  if (sessionStorage.getItem('siap_planejamento_intent')) {
    sessionStorage.removeItem('siap_planejamento_intent');
    console.log("SIAP: Roteamento de planejamento concluído. Aguardando comando...");
  }
}

const path = window.location.pathname.toLowerCase();
initInspector();

if (path.includes("login.aspx")) {
  initLoginPage();
} else {
  // If we are not on the login page and we are on a valid SIAP page, we are logged in.
  const reportLoggedIn = () => {
    safeSendMessage({ action: "LOGGED_IN" });
  };
  reportLoggedIn();
  syncSiapUserProfileToStorage();
  setInterval(() => {
    reportLoggedIn();
    syncSiapUserProfileToStorage();
  }, 5000);

  initDraftGuardian();
  if (path.includes("diarioescolarlistagem.aspx") || path.includes("planejamentoprofessorturmalistagem.aspx")) initListagemPage();
  else if (path.includes("frequenciaalunoedicao.aspx")) initEdicaoPage();
  else if (path.includes("conteudoprogramaticoedicao.aspx")) initConteudoPage();
  else if (
    path.includes("planejamentoprofessorturmaedicao.aspx") ||
    path.includes("planejamento_calendario.aspx") ||
    path.includes("planejamentoprofessorplanejamentoaulaedicao.aspx")
  ) initPlanejamentoPage();
}
