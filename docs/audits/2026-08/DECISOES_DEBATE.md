# Decisões por debate — 2026-08-16

Três decisões abertas foram resolvidas por debate entre dois agentes com papéis
fixos: **ADVOGADO** (defende a ação de menor risco para o consumidor da lib) e
**CÉTICO** (defende a ação de menor mudança, e ataca o Advogado). Regra: todo
argumento precisa de `arquivo:linha`, output de comando ou resultado de
protótipo. Argumento sem evidência foi descartado no repasse.

O orquestrador verificou de forma independente toda evidência decisiva antes de
decidir, e em dois casos essa verificação mudou o resultado.

---

## Decisão 1 — Proxy sobre `Response`: corrigir na lib ou documentar?

**Contexto.** 6 testes falham em Node 20/22 e passam em 24/26. O corte é undici
6 → 7: em undici 6 o estado do `Response` vive em propriedade de chave-símbolo,
que um `Proxy` sem traps encaminha; em undici 7+ virou campo privado, que não.

### ADVOGADO (corrigir na lib)

1. Construiu um protótipo funcionando: `Error.captureStackTrace` + sonda de
   receiver estranho, em `scratchpad/patch-draft.ts`, ~47 linhas.
2. Recusa o Proxy cru e aceita o encaminhador em Node 20, 22 e 24.
3. Não usa `node:util`, então não viola a regra de `src/errors/inspect.ts:41`.
4. Admitiu 3 bypasses baratos e classificou a mudança como robustez, não
   segurança.
5. Argumento central: `engines` diz `>=20.13.0` e a garantia some em 2 LTS
   ativos sem sinal nenhum para o consumidor.

### CÉTICO (documentar)

1. Medido contra `dist/`: em Node 20/22 o Proxy cru entrega tudo — `status=200`,
   `headers.get()`, `json()`. Recusar converte resposta boa em `NetworkError`.
2. `docs/adr/0003:56-59` — a tabela in-scope é o todo do que a lib defende;
   H-01..H-28 não tem linha para Proxy, e adicionar uma é emenda ao ADR.
3. `docs/adr/0003:143-149` — um mecanismo que não separa o real do forjado é o
   mesmo que aceita o forjado.
4. `CHANGELOG.md:631-632` — wrappers Proxy de instrumentação são rotineiros;
   recusá-los quebra uso que hoje funciona.
5. `structuredClone`, o único probe portável que separava, morre dentro do
   próprio undici 6.

### Evidência decisiva

Duas medições do orquestrador, ambas contra o **código real** do protótipo.

O ataque mais forte do Cético é **falso**: ele alegou que o patch recusa
`Response` congelado, mas testou a descrição em prosa, não o
`patch-draft.ts`, que tem guarda `!Object.isExtensible(value) → return false`.
Rodando o código real, congelado / selado / `preventExtensions` são aceitos nos
quatro runtimes.

O que decide é outra coisa — o patch rodado em Bun:

| Runtime               | proxy cru é utilizável?     | patch recusa?                   |
| --------------------- | --------------------------- | ------------------------------- |
| Node 20/22 (undici 6) | **sim, por completo**       | sim — recusa valor que funciona |
| Node 24 (undici 7)    | não                         | sim                             |
| Deno                  | sim                         | sim                             |
| **Bun**               | **não (lança `TypeError`)** | **não**                         |

Em Bun o motor aceita carimbar `stack` num `Proxy`, a regra não dispara, e o
proxy quebrado passa. `README.md:40` promete Bun; `ci.yml` tem job `bun-smoke`.

Custo medido no caminho quente, contra o `isResponse` atual:

```
node 20.15  atual=126ns  adicionado=3548ns  →  28,2x
node 22.16  atual=255ns  adicionado=2797ns  →  11,0x
node 24.13  atual=171ns  adicionado=3378ns  →  19,8x
```

### Veredito: **documentar** (opção c)

O protótipo cumpre a **letra** do envelope — funciona nos três Nodes com ~50
linhas — e por isso a opção (a) estava autorizada. Não a executei, e o motivo é
evidência que o envelope não podia prever: o patch falha justamente no runtime
onde o dano é real. Ele não entrega a garantia; move a inconsistência de
"undici 6 vs 7" para "V8-Node/Deno vs Bun", que é mais difícil de explicar ao
consumidor, não menos. Somado a 11–28x no caminho quente, 3 bypasses assumidos
e um ADR que não lista Proxy como superfície defendida, o custo compra uma
garantia que continua não valendo em todo lugar.

**Revisável em uma linha:** se o dono do repo aceitar a fronteira V8-vs-Bun, o
patch existe e está pronto em `scratchpad/patch-draft.ts`.

---

## Decisão 2 — `tests/coverage/edge-branches.spec.ts`: commitar ou não?

**Contexto.** 12 testes, 28 KB, que nunca entraram no git porque `.gitignore`
casava `tests/coverage/`. São eles que faziam a cobertura local ler 100%
enquanto o CI lia 99,29%.

### ADVOGADO (commitar)

1. Rodou diferencial de cobertura: 11 dos 12 fecham lacuna exclusiva.
2. Nomeou o dano por consumidor de cada linha — `error.clone()` devolvendo
   lixo, `cancel()` lançando, lixo no `Request.prototype` do processo.
3. Na rodada 2, **retratou-se**: reproduziu as sobrevivências e reclassificou.
4. Encontrou 5 mortes de mutação que o Cético não mediu (#3, #4, #6, #8).
5. Achado independente: `request-plan.ts:290` e `error-body.ts:380` sobrevivem
   à suíte COMPLETA — buracos que existem com ou sem este arquivo.

### CÉTICO (não commitar)

1. Rodou mutação real: 6 de 8 mutações sobreviveram com os 12 testes rodando.
2. Três testes têm **zero `expect()`** — executam a linha e não verificam nada.
3. O `describe` diz "public seams", mas todo import é caminho relativo interno.
4. 9 dos 12 trocam um global ou intrínseco; 4 apagam globais do runtime.
5. Proposta: escrever asserts reais nos specs que já existem, não commitar.

### Evidência decisiva

Bancada de mutação do orquestrador, em cópia isolada do repositório:

```
request-plan.ts:319   true->false        SOBREVIVEU
request-plan.ts:290   drop restore       SOBREVIVEU
error-body.ts:380     true->false        SOBREVIVEU
base-http-error.ts:68  false->true       MORREU
base-http-error.ts:120 false->true       MORREU
response-identity.ts:281 no-throw        MORREU
```

E a contagem de asserções por teste, verificada:

```
linha 528   0 expect      linha 547   0 expect      linha 576   0 expect
```

Cobrir não é proteger. O Advogado mediu execução; o Cético mediu detecção.

### Veredito: **commitar, com as três linhas sem asserção reescritas**

Nenhuma das duas posições de partida sobreviveu. Os três testes com zero
`expect` são indefensáveis como estavam — mas os **cenários** que eles montam
são válidos e alcançam código real. Foram reescritos contra o contrato que
estavam parados na frente: `cancel()` liquida em vez de lançar, e uma limpeza
best-effort não deixa rejeição órfã. A reescrita afirma a liquidação e instala
um listener de `unhandledRejection`.

Mesmas quatro mutações, antes e depois:

```
error-body.ts:263  SOBREVIVEU -> MORREU
error-body.ts:286  SOBREVIVEU -> MORREU
error-body.ts:304  SOBREVIVEU -> MORREU
error-body.ts:464  SOBREVIVEU -> MORREU
```

Os outros nove carregam asserções que podem falhar e entraram como estavam.
Cobertura de volta a 100% nos quatro contadores, e agora com quatro mutantes a
mais morrendo sob ela.

**Registrado e não corrigido:** `request-plan.ts:290`, `request-plan.ts:319` e
`error-body.ts:380` sobrevivem à mutação contra a suíte inteira. Um gate verde
de 100% diz que a linha rodou, nunca que uma mudança nela seria pega.

---

## Decisão 3 — os três módulos a 0%: cobrir, remover ou nada?

**Contexto.** `src/headers.ts`, `src/methods.ts` e `src/errors/index.ts`
aparecem a 0/0/0/0 na tabela do CI.

### ADVOGADO (cobrir)

1. Concedeu dois dos três: `headers.ts` e `methods.ts` emitem `export {};` — 11
   bytes, zero runtime. Cobrir seria teatro.
2. Alegou lacuna real em `src/errors/index.ts`, na direção B: classe registrada
   em `httpErrors` e esquecida no barril.
3. O único guarda que viu foi `public-surface.spec.ts:138`, que lê `dist/` e
   está sob `describe.skipIf(!distExists)`.
4. `rg 'import \* as'` em `tests/` retorna zero — ninguém lê o barril como
   namespace.
5. Propôs um teste de ~10 linhas comparando o namespace com `httpErrors`.

### CÉTICO (nada a escrever)

1. Provou 0 statements nos três, via `coverage.reporter=json-summary`.
2. Explicou local × CI: `std-env.isAgent` liga `skipFull: true`, e arquivo vazio
   tem `pct: 100`, então some da tabela local. É flag do reporter, não ambiente.
3. **Refutou a lacuna com demonstração executada**: `fixtures/error-roster.ts:42`
   importa as 40 classes do barril, e `roster-sync.spec.ts:485` fixa esse import.
4. Numa cópia, registrou uma classe e esqueceu o barril: `roster-sync.spec.ts`
   e `error-classes.spec.ts` ficam vermelhos, e `tsc` dá `TS2305` — sem `dist/`.
5. Admitiu um resíduo: um import direto extra no fixture escapa do assert.

### Evidência decisiva

`fixtures/error-roster.ts:42` → `} from "../src/errors";`, e
`roster-sync.spec.ts:485` exige essa string. Três portas fecham o esquecimento
do barril, nenhuma delas dependente de `dist/`.

### Veredito: **nada a cobrir; uma linha para fechar o resíduo**

Os três módulos são triviais e o 0% é artefato de relatório para arquivo com
zero statements. Nenhum é código morto. A lacuna que o Advogado levantou já
está fechada — mas o resíduo que o próprio Cético admitiu é real, e custa uma
linha: o assert em `roster-sync.spec.ts` passou a proibir
`from "../src/errors/` dentro de `error-roster.ts`. Verificado: 95 testes
verdes, e um import direto plantado fica vermelho.

---

## Resumo

| #   | Decisão                 | Veredito                                 | Lado que prevaleceu                              |
| --- | ----------------------- | ---------------------------------------- | ------------------------------------------------ |
| 1   | Proxy sobre `Response`  | Documentar por `process.versions.undici` | Cético, por evidência que nenhum dos dois trouxe |
| 2   | `edge-branches.spec.ts` | Commitar, com 3 rows reescritos          | Nenhum — síntese                                 |
| 3   | Módulos a 0%            | Nada a cobrir + 1 linha de guard         | Cético, com resíduo do próprio Cético fechado    |

Nenhuma decisão foi por default. As três tiveram evidência decisiva, e em duas
delas a verificação independente do orquestrador contradisse o lado que a
alegou.
