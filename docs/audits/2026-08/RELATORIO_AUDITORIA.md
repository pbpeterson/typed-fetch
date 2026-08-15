# Relatório de auditoria de pré-publicação

**Pacote:** `@pbpeterson/typed-fetch`
**Versão no repositório:** 2.0.1 (`package.json:3`)
**Versão no npm:** 2.0.0 (`npm view @pbpeterson/typed-fetch dist-tags`)
**Data:** 2026-08-15
**Método:** 4 agentes em paralelo, escopo fechado por área, escala 1–5 com evidência obrigatória para toda nota ≤ 3.
**Ambiente:** darwin, Node 26.7.0, Bun 1.3.13, Deno 2.9.5, pnpm 10.33.0

---

## 1. Tabela-resumo

| Área                                | Itens  | Nota média | Pior item                                               | Nota  |
| ----------------------------------- | ------ | ---------- | ------------------------------------------------------- | ----- |
| 1. Corretude e testes               | 9      | **4.1**    | Determinismo da suíte (gate de release)                 | 3     |
| 2. Segurança e robustez             | 10     | **4.6**    | Gate de release depende de teste sensível a timing      | 3     |
| 3. API e documentação               | 10     | **3.8**    | `package.json` em 2.0.1 conflita com CHANGELOG e semver | 3     |
| 4. Empacotamento e manutenibilidade | 10     | **4.6**    | Paridade CJS/ESM: nomes de classe e ponto de extensão   | 3     |
| **Global**                          | **39** | **4.28**   | —                                                       | **3** |

Distribuição das notas: 5 → 22 itens · 4 → 7 itens · 3 → 10 itens · 2 → 0 · 1 → 0.

---

## 2. Bloqueantes (notas 1–2)

**Nenhum.** Nenhum agente atribuiu nota 1 ou 2 em nenhum item. A nota mínima em toda a auditoria foi 3.

Isto significa: não existe defeito que torne o pacote inseguro, quebrado ou inutilizável para o consumidor. O que segue abaixo são correções recomendadas, não impedimentos técnicos de funcionamento.

---

## 3. Recomendado antes de publicar (nota 3)

Ordenado por severidade prática.

### 3.1 — A versão 2.0.1 não pode ser publicada; o próximo release tem de ser ≥ 2.1.0

**Área:** API e documentação · **Nota:** 3

**Evidência:**

- `package.json:3` → `"version": "2.0.1"`
- `CHANGELOG.md:285-291` → `## [2.0.1] - 2026-08-03 — NEVER PUBLISHED` / "`2.0.1` is not on npm, and no `v2.0.1` git tag exists. ... Do not try to install `2.0.1`"
- `npm view @pbpeterson/typed-fetch dist-tags` → `{"latest":"2.0.0"}`
- O rodapé do CHANGELOG não tem entrada `[2.0.1]:`; o `[Unreleased]:` compara `v2.0.0...HEAD`
- `RELEASING.md:333` → "A change in what `toJSON().url` emits is a `minor` at least"
- `CHANGELOG.md:258-282` (seção `[Unreleased]`) declara exatamente essa mudança: "Anything that greps or alerts on `error.message` or `toJSON().url` sees a different string after this upgrade."

**Por que importa:** o repositório está parado num número de versão que o próprio CHANGELOG proíbe instalar, e o conteúdo não publicado já contém uma mudança que a regra interna classifica como `minor`. Publicar qualquer `2.0.x` viola o contrato de versionamento declarado. `scripts/validate-release.mjs:260-269` provavelmente barra o publish por falta do link de rodapé, então o erro seria pego — mas o estado do repositório precisa ser corrigido de qualquer forma.

**Correção:** bumpar para `2.1.0`, criar a seção correspondente no CHANGELOG com link de rodapé, e mover o conteúdo de `[Unreleased]`.

**Nota adicional:** a seção "Semantic version contract" do `README.md:1332-1342` não cita `toJSON().url` em nenhuma das 9 cláusulas. A regra só existe no `RELEASING.md`, que o consumidor não lê.

---

### 3.2 — Teste sensível a timing torna o gate de release não determinístico

**Área:** Corretude e testes + Segurança (achado independente por **dois** agentes) · **Nota:** 3

**Evidência (agente 1, `pnpm coverage` em árvore limpa):**

```
 Test Files  3 failed | 129 passed (132)
FAIL scripts/check-consumer-entry.spec.mjs:973 — expected 1 to be +0
FAIL tests/redaction/redact-url.spec.ts:179 — expected 11.86 to be less than 9
FAIL tests/surface/public-surface.spec.ts:262
  Error: Cannot find module '.../dist/index.mjs' imported from fixtures/built-package.ts
```

Duas execuções idênticas seguintes passaram 132/132 sem nenhuma mudança de código.

**Evidência (agente 2, `pnpm test`, execução independente):**

```
FAIL tests/redaction/redact-url.spec.ts > the scan stays linear on an input of repeated `://` marks
AssertionError: expected 19.97753852706877 to be less than 9
 ❯ tests/redaction/redact-url.spec.ts:179:27
```

Execução 2 do mesmo comando, sem alteração: `Test Files 132 passed (132)`. Isolado, passou 3/3 (agente 2) e 5/5 (agente 1).

**Total observado:** 2 falhas do mesmo teste em 5 execuções da suíte completa, por dois agentes que não se comunicaram.

**Código:** `tests/redaction/redact-url.spec.ts:163-179`

```ts no-check
const small = timed(8_000);
const large = timed(32_000);
expect(large / small).toBeLessThan(9);
```

**Por que importa:** `release.yml:21` roda a suíte inteira como pré-condição do publish, em runner compartilhado do GitHub Actions — mais ruidoso que estas máquinas. O algoritmo **é** linear (o agente 2 confirmou por medição independente: 8 KB → 4.5 ms, 64 KB → 12.4 ms). O defeito está no gate, não no código. O comentário do próprio teste (`redact-url.spec.ts:154-162`) registra que a versão anterior, com relógio absoluto, falhava 1 em 4 execuções e foi trocada por razão — a razão continua falhando.

**Correção:** tirar os testes de tempo do gate de release, rodá-los com `test.sequential` / em arquivo sem paralelismo, ou trocar a medição de tempo por contagem de operações instrumentada. Outros 5 arquivos usam `performance.now` e correm o mesmo risco: `tests/response/response-loop-bound.spec.ts`, `tests/redaction/redaction-span-needle-derivation.spec.ts`, `redaction-embedded-mark-cost.spec.ts`, `redaction-message-route-cost.spec.ts`, `redaction-message-needle-span.spec.ts`.

**Os outros 2 modos de falha da primeira execução são distintos** (npm frio; corrida de leitura com `dist/` sendo reescrito no meio do run) e precisam de investigação própria — ver seção 5.

---

### 3.3 — Paridade CJS/ESM: nomes de classe e ponto de extensão divergem

**Área:** Empacotamento · **Nota:** 3

**Evidência (contra o tarball instalado, não contra `src/`):**

```
=== CJS ===                              === ESM ===
NotFoundError.name = "_class9"           NotFoundError.name = "NotFoundError"
NetworkError.name  = "_class2"           NetworkError.name  = "NetworkError"
err.constructor.name = _class2           err.constructor.name = NetworkError
```

Subclasse do consumidor com accessor em `name` — o ponto de extensão documentado:

```
=== CJS === subclass THREW: TypeError - Cannot write private member #n to an object
                            whose class did not declare it
=== ESM === subclass OK
```

`rg -o "_class[0-9]*" dist/chunk-WFDD2D27.js | sort -u | wc -l` → **44** classes afetadas. O chunk ESM tem **0**.

**Causa:** `tsup.config.ts:29` liga `splitting: true` — necessário para o `instanceof` funcionar entre os entry points `.` e `./errors`. No lado CJS o tsup passa pelo Sucrase, que rebaixa class fields e transforma `class extends X { name = "..." }` em `(_class9 = class extends X {...}, _class9)`, perdendo o `Function.name` inferido e trocando `[[Define]]` por `[[Set]]`.

**Impacto real:** `err.constructor.name` diverge entre formatos (afeta loggers e serializadores). Uma subclasse do consumidor com accessor em `name`/`status`/`statusText` **lança sob `require()` e funciona sob `import`**. O `error.name` da instância continua correto nos dois formatos e os guards por brand não são afetados — por isso não é bloqueante.

**Estado:** já registrado em `docs/audit-ledger.md:427-449` como "OPEN, and a maintainer's decision rather than a defect to fix quietly". Segue não decidido, não exposto ao consumidor no README, e nenhum gate de CI o pega (`check-consumer` só lê o `error.name` da instância).

---

### 3.4 — A opção `fetch` só é lida como propriedade própria, e o JSDoc não avisa

**Área:** API e documentação · **Nota:** 3

**Evidência:** `src/request-plan.ts:357-358` e `dist/index.d.ts:160-161` — o JSDoc publicado é uma linha:

```
/** Override the fetch implementation (testing, DI, custom agents). */
```

Teste executado:

```
own fetch used:   true
proto fetch used: false | error: NetworkError Network error
class fetch used: false | error: NetworkError
```

**Por que importa:** um `fetch` herdado do protótipo (`Object.create({fetch})`) ou um método `fetch` de uma classe usada como `options` é ignorado **em silêncio** e a requisição sai para a rede de verdade, com os headers do chamador. É a única opção da API com regra diferente das demais, e a falha não avisa. A regra está no `README.md:779` e existe por um motivo de segurança legítimo (fechar `Object.prototype.fetch = evil`), mas o JSDoc é o que o dev lê no IntelliSense.

**Correção:** copiar o parágrafo do README para o JSDoc.

---

### 3.5 — Link quebrado no caminho de upgrade

**Área:** API e documentação · **Nota:** 3

**Evidência:**

```
README.md:1315 -> CHANGELOG.md#200---2026-07-26   NOT FOUND
CHANGELOG.md:365: ## [2.0.0] - 2026-07-30        (âncora real: #200---2026-07-30)
```

Nenhum outro link do README está quebrado. O gate `check-doc-style` passa porque só verifica se o link é absoluto — não resolve âncoras (`scripts/check-doc-style.mjs:18-20`, `368-398`).

**Por que importa:** é o link da frase "The migration table is in CHANGELOG.md" dentro do "Upgrade from 1.x". O dev que mais precisa dele cai no topo de um CHANGELOG de 104 KB. Data errada por 4 dias, correção de um caractere, mas nenhum gate pega.

---

### 3.6 — `UnknownHttpError.statusText` documentado sem ressalva de runtime

**Área:** API e documentação · **Nota:** 3

**Evidência:** mesmo exemplo (status 599, reason phrase "Weird Status"):

```
Node:  statusText: "Weird Status"
Bun:   statusText: "Weird Status"
Deno:  statusText: ""
```

Sonda com `fetch` puro confirma que a causa é o runtime: no Deno, `bare fetch statusText: ""`.

**Por que importa:** `README.md:1008` afirma sem condição "its `statusText` is the reason phrase the server sent, filtered and bounded", e `README.md:293` repete. O README lista Deno como runtime suportado (`README.md:40`) e já traz nota equivalente para o Bun (`README.md:492`) — falta a análoga para o Deno. A biblioteca está correta; a documentação é que promete demais.

---

### 3.7 — O union destruturado não estreita com type guard, e o README não explica

**Área:** API e documentação · **Nota:** 3

**Evidência:** typecheck em projeto consumidor limpo (TS 5.9, strict):

```
src/eot.ts(15,30): error TS18047: 'c.response' is possibly 'null'.
```

para `if (isHttpError(c.error)) { ... } else { await c.response.json(); }`

**Por que importa:** é limitação do TypeScript, não bug da lib — mas é a razão de todo exemplo do README terminar com o ramo estranho `else if (!error) { await response.body?.cancel(); }` em vez do natural `else { response.json() }`. O README nunca explica isso. O dev que escreve o guard primeiro toma TS18047 e não acha resposta na documentação.

**Correção:** um parágrafo na "API reference" dizendo que só `if (error)` / `if (!error)` estreita o `response`.

---

### 3.8 — Testes acoplados a texto-fonte e a prosa de documentação

**Área:** Corretude e testes · **Nota:** 3

**Evidência:**

- `tests/errors/error-classes.spec.ts:403-405` — lê `src/errors/base-http-error.ts` como texto: `expect(src).not.toMatch(/this\.name\s*=\s*this\.constructor\.name/)`
- `tests/errors/base-http-error.spec.ts:985-993` — recorta JSDoc do fonte: `expect(cancelDoc).toMatch(/stream FAILED|body stream failed/i)`
- `tests/surface/surface-release-gate-roster.spec.ts:196-203` — exige uma frase em prosa literalmente em `CONTEXT.md` **e** em `src/request-plan.ts`
- `tests/surface/surface-bun-smoke-exclusion-reason.spec.ts:105-107` — afirma que **outro arquivo de teste** contém as strings exatas `spawnSync("bun", ["--version"]` e `describe.skipIf(!distExists || !bunAvailable)`

**Por que importa:** esses testes quebram com um renomear de variável ou uma reescrita de comentário que não muda comportamento nenhum. O caso do `.name` tem equivalente observável (construir subclasse e ler `error.name`), então o teste de texto é escolha, não necessidade. O último é o pior: um teste que valida o código-fonte de outro teste. Custo de manutenção, não risco de publicação.

---

## 4. Pontos fortes verificados por execução

Registrados porque sustentam o veredito e foram medidos, não presumidos.

| Verificação                   | Resultado                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cobertura (`pnpm coverage`)   | 100% statements / branches / functions / lines — 2861 stmts, 1533 branches, 487 fns. Threshold 100 travado em `vitest.config.ts:33-38`, só 8 diretivas `v8 ignore` em `src/` |
| Suíte                         | 132 arquivos, 3765 testes passando                                                                                                                                           |
| `pnpm audit --prod`           | `No known vulnerabilities found` — **1** dependência total (zero deps de produção)                                                                                           |
| `pnpm audit` (dev)            | `No known vulnerabilities found` — 193 deps                                                                                                                                  |
| Segredos no histórico git     | `git log -p --all` com padrões de token/chave → **nenhum match**                                                                                                             |
| Input hostil                  | 17 entradas hostis + 28 cenários `fixtures/hostile-fetch.ts` — **nenhuma lançou**, todas retornaram valor                                                                    |
| Prototype pollution           | `rg "JSON.parse" src/` → zero. `Object.hasOwn` fecha o vetor `Object.prototype.fetch`                                                                                        |
| Header injection CRLF         | Recusado; mensagem de erro não copia o valor recusado (sem CR/LF cru em log)                                                                                                 |
| Vazamento de credenciais      | Ausente de `message`, `stack`, `toJSON`, `inspect`, `String(error)`                                                                                                          |
| ReDoS                         | Uma única regex em `src/`, sem quantificador aninhado. 64 KB patológico → 12.4 ms (linear)                                                                                   |
| `attw` (are-the-types-wrong)  | `No problems found 🌟` — 3 subpaths × 4 modos de resolução                                                                                                                   |
| `tsc` no pacote instalado     | `node16`, `nodenext`, `bundler`, `node10` → todos exit 0                                                                                                                     |
| Tarball                       | 14 arquivos, 100.8 kB. Nada vaza (allowlist `files`)                                                                                                                         |
| Exemplos do README            | 13 exemplos rodados contra servidor HTTP local em Node + Bun + Deno — todos passam                                                                                           |
| `pnpm check-docs`             | 44 blocos de código de 79 fontes typecheckam contra `dist/` em 3 perfis de lib                                                                                               |
| Tabela das 40 classes de erro | Zero drift entre README e runtime, incluindo casos de rasteira (413, 418, 422)                                                                                               |
| Smoke multi-runtime           | `smoke:bun`, `smoke:deno`, `smoke:node-min` → todos exit 0                                                                                                                   |
| Supply chain de publicação    | OIDC trusted publishing, sem token de longa duração, actions fixadas por SHA, `--ignore-scripts --provenance`, `sha256sum -c` antes do publish                               |
| Gates locais                  | `lint` (0 errors), `format:check`, `typecheck`, `verify-pack` → todos passam                                                                                                 |
| Código morto                  | 2 exports internos não usados em 118; nenhum na superfície pública                                                                                                           |

**Reconciliação entre agentes:** o agente 2 marcou "input hostil sob Deno e Bun" como não verificado por acreditar que os runtimes não estavam instalados. Estavam — o agente 4 rodou `smoke:bun` (Bun 1.3.13) e `smoke:deno` (Deno 2.9.5) com sucesso, e o agente 3 rodou os 13 exemplos do README nos três runtimes. A lacuna real remanescente é apenas o _corpus hostil completo_ sob Deno/Bun, não os runtimes em si.

---

## 5. Veredito final

## PUBLICAR APÓS CORREÇÕES

A biblioteca é tecnicamente sólida: zero bloqueantes em 39 itens auditados, 100% de cobertura real e travada, zero dependências de produção, zero CVEs, zero segredos no histórico, e uma cadeia de publicação por OIDC que é padrão-ouro. Nada aqui é defeito de funcionamento.

O que impede publicar hoje é mecânico e barato: o `package.json` está numa versão que o próprio CHANGELOG marca como "NEVER PUBLISHED", e o conteúdo não lançado exige `minor` pela regra do `RELEASING.md` — o número tem de virar `2.1.0` antes de qualquer coisa.

Junto disso, vale estabilizar o teste de timing que já falhou 2 vezes em 5 execuções da suíte completa, porque essa mesma suíte é a pré-condição do publish em runner compartilhado — mais ruidoso que as máquinas onde a auditoria rodou.

### Ordem sugerida antes do release

1. Bumpar versão para `2.1.0` + seção e link de rodapé no CHANGELOG (§3.1)
2. Tirar os testes de tempo do gate de release (§3.2)
3. Corrigir a âncora do link em `README.md:1315` (§3.5)
4. Copiar a regra do own-property `fetch` para o JSDoc (§3.4)
5. Adicionar a ressalva do Deno em `statusText` (§3.6)
6. Decidir (ou documentar) a divergência CJS/ESM de `constructor.name` (§3.3)

Itens 7–8 (§3.7 narrowing, §3.8 testes acoplados a texto) podem esperar o release seguinte.

---

## 6. O que NÃO foi verificado, e por quê

### Ambiente indisponível

| Item                                    | Motivo                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Comportamento em browser / edge runtime | Sem runtime de browser na máquina. `README.md:40` lista ambos como suportados; a redação e a classificação sob `lib.dom` ficam sem prova executada                                         |
| Comportamento em Windows                | Auditoria rodou só em darwin. 6 blocos usam `skipIf(process.platform === "win32")`                                                                                                         |
| Suporte ao piso Node 20.13.0            | Ambiente roda Node 26.7.0. O próprio `smoke:node-min` declara em voz alta: "This run does NOT prove floor support." O job `node-min-smoke` da CI fixa `node-version: 20.13.0` e cobre isso |
| Corpus hostil completo sob Deno e Bun   | Os runtimes existem e os smokes passaram, mas os 28 cenários de `fixtures/hostile-fetch.ts` só foram exercitados em Node                                                                   |

### Não executável numa auditoria local

| Item                                                     | Motivo                                                                                                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caminho de publicação do `release.yml`                   | Exige tag `v*` real e OIDC contra o registry npm. `scripts/validate-release.mjs` existe e é chamado, mas não foi disparado porque a versão local não tem tag publicada |
| `npx skills add pbpeterson/typed-fetch` (`README.md:47`) | Exige a CLI externa `skills` e rede. Só confirmado que `skills/typed-fetch/SKILL.md` existe e é versionado                                                             |
| Renderização dos badges (`README.md:3-5`)                | Exige rede para GitHub Actions e shields.io                                                                                                                            |

### Investigação incompleta

| Item                                                     | Motivo                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Causa raiz da reescrita de `dist/` no meio da suíte**  | Os mtimes de `dist/` mudaram durante o primeiro `pnpm coverage`, causando `Cannot find module '.../dist/index.mjs'`. Nenhum spec invoca `pnpm build`/`tsup` (`rg` em `scripts/`, `tests/`, `fixtures/`) e `npm pack --dry-run` não reescreve `dist/`. O sintoma reproduz como falha; **o gatilho não foi isolado**. Merece investigação própria |
| Comportamento em checkout limpo sem `dist/`              | A suíte tem 102 `skipIf` em 37 arquivos, muitos com `!distExists`. `dist/` não foi apagado porque a auditoria é read-only — não foi medido quantos testes silenciam nesse cenário                                                                                                                                                               |
| Taxa real do flake em CI                                 | 2 falhas observadas em 5 execuções locais. A frequência em runner do GitHub Actions não foi estimada                                                                                                                                                                                                                                            |
| Tabela de contagem de conexões TCP (`README.md:325-343`) | Medida declarada em Node 20.15.0; o harness não foi reproduzido (ambiente em Node 26.7.0)                                                                                                                                                                                                                                                       |
| Nota do Bun em `README.md:492`                           | O cenário de reader travado sem leitura não foi construído                                                                                                                                                                                                                                                                                      |
| Cobertura de `index.ts` da raiz                          | `vitest.config.ts:20` não inclui o arquivo na medição. São 11 linhas de re-export, cobertas indiretamente por `tests/surface/public-surface.spec.ts`                                                                                                                                                                                            |
| `scripts/smoke/bun.mjs` e `scripts/smoke/deno.ts`        | Excluídos da cobertura por `vitest.config.ts:27`                                                                                                                                                                                                                                                                                                |
| CVEs divulgados após 2026-08-15                          | `pnpm audit` reflete o advisory DB no momento da consulta                                                                                                                                                                                                                                                                                       |

---

_Auditoria read-only. Nenhum arquivo do projeto foi modificado. `git status --porcelain` vazio ao final, exceto por este relatório._
