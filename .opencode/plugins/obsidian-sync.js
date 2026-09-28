/**
 * Hook de sincronização do vault Obsidian do GCON/SIAN.
 *
 * Ideia: a maior parte do que o vault registra é MECÂNICA e determinística
 * (commits, acurácia da bancada, regressão verde). Disso não precisa de modelo
 * nenhum — o hook escreve direto, com custo zero e sem chance de alucinar.
 * A camada semântica (por que mudou) é do subagente `obsidian`.
 *
 * Camadas:
 *   1 · mecânica  — este arquivo, a cada session.idle, sem LLM
 *   2 · semântica — o subagente `obsidian`, só quando o conteúdo mudou
 *
 * Guardas: debounce, fingerprint, e nunca age em sessão iniciada por ele mesmo.
 * Só usa módulos embutidos, porque o .opencode/.gitignore ignora package.json
 * e portanto não pode-se depender de nada instalado.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const VAULT = process.env.GCON_VAULT || path.join(HOME, 'Documents', 'Obsidian', 'GCON-SIAN');
const MOC = path.join(VAULT, '00 - MOC - GCON-SIAN.md');
const DEBOUNCE_MS = 90 * 1000;

let ultimoSync = 0;
let ultimoFingerprint = '';
let rodando = false;
let pendenteSemantico = false;

function hoje() { return new Date().toISOString().slice(0, 10); }

function log(client, level, message, extra) {
  try {
    client.app.log({ body: { service: 'obsidian-sync', level, message, ...(extra ? { extra } : {}) } });
  } catch (e) { /* logging nunca pode derrubar a sessão */ }
}

/** Comando git somente de leitura, via shell do Bun ($), sem shell injection. */
async function git(client, $, args) {
  try {
    const res = await $`git ${args}`;
    return (res.stdout || '').toString().trim();
  } catch (e) {
    log(client, 'debug', 'git falhou', { args: String(args), erro: String(e && e.message) });
    return '';
  }
}

/**
 * Reescreve SÓ o bloco "## Estado atual (...)" do MOC.
 * Nunca toca no resto: o MOC tem ~30 seções escritas à mão.
 */
function blocoEstado(moc, d) {
  const alvo = /## Estado atual \([^\n]*\)\n[\s\S]*?(?=\n## |$)/;
  if (!alvo.test(moc)) return null;
  const bloco =
    `## Estado atual (${hoje()})\n` +
    `\n> Bloco mantido pelo hook \`obsidian-sync\` (mecânico, sem LLM). O raciocínio por trás fica nas notas.\n\n` +
    `| Item | Situação |\n|---|---|\n` +
    `| Branch / push | \`${d.branch}\` · ${d.ahead} commit(s) à frente do origin · ${d.behind} atrás |\n` +
    `| Último commit | ${d.ultimo} |\n` +
    `| Árvore de trabalho | ${d.alterados === 0 ? 'limpa' : d.alterados + ' arquivo(s) alterado(s)'} |\n` +
    `| Bancada de PDF | ${d.bancada} |\n` +
    `| Regressão estrutural | \`npm run test:rapido\` (testes/regressao.mjs) |\n` +
    `| Hook | ativo · agent \`obsidian\` disponível · vault fora do git |\n\n`;
  return moc.replace(alvo, bloco);
}

function lerBancada(dir) {
  try {
    const arq = path.join(dir, 'testes', 'saidas', 'metricas.txt');
    const txt = fs.readFileSync(arq, 'utf8');
    const m = /Acur.cia global:\s*(\d+\/\d+\s*=\s*\d+%)/.exec(txt);
    if (!m) return 'sem métrica legível';
    const min = Math.round((Date.now() - fs.statSync(arq).mtime.getTime()) / 60000);
    const quando = min < 2 ? 'agora' : min < 90 ? 'há ' + min + ' min' : 'resultado antigo (' + Math.round(min / 1440) + ' d)';
    return m[1].trim() + ' · ' + quando;
  } catch (e) {
    return 'não executada nesta sessão';
  }
}

export const ObsidianSyncPlugin = async ({ client, $, worktree }) => {
  const dir = worktree || process.cwd();

  async function coletar() {
    const branch = (await git(client, $, ['rev-parse', '--abbrev-ref', 'HEAD'])) || '(?)';
    const ultimo = (await git(client, $, ['log', '-1', '--pretty=%h %s'])) || '(sem commits)';
    // `rev-list --left-right --count origin/main...HEAD` devolve "<commits só no origin> <commits só no HEAD>"
    const ab = await git(client, $, ['rev-list', '--left-right', '--count', 'origin/main...HEAD']);
    const [somenteOrigin = '?', somenteHead = '?'] = ab.split(/\s+/);
    const behind = somenteOrigin;   // commits que estão no remote e não aqui
    const ahead = somenteHead;      // commits locais ainda não pushados
    const status = await git(client, $, ['status', '--porcelain']);
    const alterados = status ? status.split('\n').filter(Boolean).length : 0;
    return { branch, ultimo, ahead, behind, alterados, bancada: lerBancada(dir) };
  }

  async function sincronizar(forcar) {
    if (rodando) return;
    if (!forcar && Date.now() - ultimoSync < DEBOUNCE_MS) {
      log(client, 'debug', 'debounce: sync adiado');
      return;
    }
    if (!fs.existsSync(MOC)) {
      log(client, 'warn', 'MOC do vault não encontrado; sync mecânico inativo', { moc: MOC });
      return;
    }
    rodando = true;
    try {
      const d = await coletar();
      const fp = [d.branch, d.ultimo, d.ahead, d.alterados, d.bancada].join('|');
      if (!forcar && fp === ultimoFingerprint) {
        log(client, 'debug', 'nada mudou desde o último sync');
        return;
      }
      const moc = fs.readFileSync(MOC, 'utf8');
      const novo = blocoEstado(moc, d);
      if (novo && novo !== moc) {
        fs.writeFileSync(MOC, novo, 'utf8');
        log(client, 'info', 'MOC atualizado (bloco de estado)', { fp });
      }
      ultimoFingerprint = fp;
      ultimoSync = Date.now();
      if (d.alterados > 0) pendenteSemantico = true;
    } catch (e) {
      log(client, 'error', 'sync mecânico falhou', { erro: String(e && e.message) });
    } finally {
      rodando = false;
    }
  }

  return {
    event: async ({ event }) => {
      try {
        const p = event.properties || {};
        if (event.type === 'session.idle') {
          const info = p.info || p;
          // nunca age em sessão de subagente: quem cuida do conteúdo é o agente `obsidian`
          if (info && info.parentID) return;
          await sincronizar(false);
          if (pendenteSemantico) {
            pendenteSemantico = false;
            log(client, 'info', 'mudança não registrada no vault; rode /obsidian');
          }
        }
        if (event.type === 'command.executed') {
          const cmd = String(p.command || '');
          if (/^(passeio|alimentar|obsidian)\b/.test(cmd)) await sincronizar(true);
        }
        if (event.type === 'file.edited') {
          const alvo = String(p.filePath || p.path || '');
          if (/^(index\.html|README\.md|conhecimento\/)/.test(alvo)) pendenteSemantico = true;
        }
      } catch (e) {
        log(client, 'error', 'hook de evento falhou', { erro: String(e && e.message) });
      }
    },

    /* Se a sessão for compactada, o vault entra no contexto — assim o agente não
       "esquece" dele no meio do trabalho. */
    'experimental.session.compacting': async (input, output) => {
      try {
        if (!Array.isArray(output.context)) output.context = [];
        output.context.push(
          '[GCON/SIAN · vault Obsidian] O vault do projeto está em ' + VAULT +
          ' (fora do repo, nunca versionado). Ele guarda o estado e o raciocínio de cada ciclo:' +
          ' MOC, notas técnicas, aprendizados dos 7 agentes e dívidas abertas. Sempre que surgir uma' +
          ' decisão, uma dívida ou um aprendizado, atualize a nota correspondente e volte ao MOC.' +
          ' O subagente `obsidian` faz essa manutenção por conta própria, com escrita restrita ao vault.'
        );
      } catch (e) { /* noop */ }
    },
  };
};

export default ObsidianSyncPlugin;
