# Investigação: o que reescreve `dist/` durante `pnpm coverage`

**Status: RESOLVIDO.** O gatilho foi isolado e reproduzido sob demanda.

**Causa raiz:** um `pnpm build` rodando contra a mesma working tree enquanto a
suíte roda. `tsup.config.ts:19` tem `clean: true`, então o tsup **apaga**
`dist/` antes de reescrever. Qualquer spec que importe `dist/` dentro dessa
janela falha com `Cannot find module`.

Não é defeito do pacote. São dois processos dividindo um checkout.

---

## 1. O sintoma original

Durante a auditoria de pré-publicação, a primeira execução de `pnpm coverage`
numa árvore limpa falhou em 3 arquivos, e as duas execuções seguintes passaram
132/132 sem nenhuma mudança de código:

```
 Test Files  3 failed | 129 passed (132)

FAIL scripts/check-consumer-entry.spec.mjs:973 — expected 1 to be +0
FAIL tests/redaction/redact-url.spec.ts:179 — expected 11.86 to be less than 9
FAIL tests/surface/public-surface.spec.ts:262
  Error: Cannot find module '.../dist/index.mjs' imported from fixtures/built-package.ts
```

Os mtimes de `dist/` haviam mudado no meio da execução.

---

## 2. O que foi descartado, e como

Tudo abaixo foi verificado, não presumido.

| Hipótese                                                                                                 | Como foi descartada                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hooks de ciclo de vida do npm (`pretest`, `posttest`, `prepare`, `prepack`)                              | O único hook em `package.json` é `prepublishOnly`, e `npm pack` não o roda — `RELEASING.md:122-125` já registra isso. Nenhum `pre*`/`post*` existe.                                             |
| `globalSetup` / `setupFiles` do vitest                                                                   | `vitest.config.ts` não declara nenhum dos dois.                                                                                                                                                 |
| Watch mode do tsup                                                                                       | Nenhum script chama `tsup --watch`; `pnpm build` é `tsup` sem flags.                                                                                                                            |
| Hooks do pnpm                                                                                            | Não existem `.pnpmfile.cjs` nem `.npmrc` no repositório.                                                                                                                                        |
| Algum spec chamando `pnpm build`                                                                         | `rg` sobre `tests/`, `scripts/` e `fixtures/` não acha nenhuma invocação de build. As menções a `pnpm build` são todas texto de mensagem de erro ou comentário.                                 |
| `scripts/gate-mutation-skipped-jobs.spec.mjs:497-501`, que apaga `dist/.env` e `dist/errors/index.d.mts` | O `root` desse spec é um `mkdtempSync`, materializado por `cpSync` com `node_modules` como **único** symlink (`materializedRepo()`, linha 464). Os `rmSync` apagam cópias, nunca a árvore real. |
| `npm pack` reescrevendo `dist/`                                                                          | `npm pack --dry-run` na raiz não altera mtime de `dist/` (medido antes/depois).                                                                                                                 |

---

## 3. Experimento A — controle: a suíte sozinha não toca `dist/`

Um monitor amostra `dist/` a cada 150 ms e registra qualquer arquivo que
apareça, suma, mude de tamanho ou de mtime.

```
=== BEFORE ===  eecfe3a071c2799d7606c2df6b836e417a798631
      Tests  3765 passed | 1 expected fail (3766)
=== AFTER ===   eecfe3a071c2799d7606c2df6b836e417a798631

=== WATCHER LOG ===
2026-08-15T17:11:48.854Z START watching .../dist — 10 files
```

Checksum agregado idêntico antes e depois. **Zero eventos** ao longo de todo o
`pnpm coverage` (~114 s). Nada dentro da suíte escreve em `dist/`.

---

## 4. Experimento B — reprodução: `pnpm build` concorrente

Mesmo monitor, agora com um `pnpm build` disparado 25 s depois do início da
suíte.

```
>>> starting concurrent pnpm build at 17:14:16

 FAIL tests/surface/surface-message-guarantee.spec.ts > the emitted url over a generated corpus
 Error: Cannot find module '.../dist/errors/index.mjs' imported from fixtures/built-package.ts
 FAIL tests/surface/surface-message-guarantee.spec.ts > the two channels that keep `error.cause`
 Error: Cannot find module '.../dist/errors/index.mjs' imported from fixtures/built-package.ts

      Tests  2 failed | 3763 passed | 1 expected fail (3766)

=== WATCHER LOG ===
17:13:50.312 START watching .../dist — 10 files
17:14:17.675 CHANGE removed=6 total=4 :: -dist/chunk-WFDD2D27.js -dist/chunk-WH32MJO5.mjs
                                         -dist/index.js -dist/index.mjs
                                         -dist/errors/index.js -dist/errors/index.mjs
17:14:17.879 CHANGE added=6   total=10
17:14:19.206 CHANGE removed=4 total=6  :: -dist/index.d.mts -dist/index.d.ts
                                          -dist/errors/index.d.mts -dist/errors/index.d.ts
17:14:20.445 CHANGE added=4   total=10
```

O momento exato da reescrita, medido:

| Janela                      | Arquivos ausentes                | Duração     |
| --------------------------- | -------------------------------- | ----------- |
| 17:14:17.675 → 17:14:17.879 | os 6 entry points JS e os chunks | **204 ms**  |
| 17:14:19.206 → 17:14:20.445 | os 4 arquivos de declaração      | **1239 ms** |

Um spec que importe `dist/` dentro de qualquer uma das duas janelas falha. Foi o
que aconteceu com dois deles.

---

## 5. Por que aconteceu na auditoria

A auditoria rodou **4 agentes em paralelo na mesma working tree**. O agente de
empacotamento tinha `pnpm build` e `npm pack` no escopo; o agente de corretude
tinha `pnpm coverage`. Os dois rodaram ao mesmo tempo, no mesmo diretório.

Isso também explica os outros dois modos de falha daquela execução:

- `check-consumer-entry.spec.mjs:973` (`expected 1 to be +0`) lê o manifesto de
  `dist/`, e o agente de empacotamento estava rodando `npm pack` e
  `attw` contra a mesma árvore.
- `redact-url.spec.ts:179` (`expected 11.86 to be less than 9`) era um teste de
  razão de tempo com folga estreita, e havia dois processos pesados dividindo a
  CPU. Esse assert já foi substituído — ver commit `4f5786b`.

**A CI não é afetada.** `ci.yml` roda `pnpm build` e `pnpm test` em sequência,
dentro do mesmo job. Não há build concorrente com a suíte em nenhum caminho de
CI ou de release.

---

## 6. O que mudou no repositório

O gatilho é externo, então não há bug de produto a corrigir. O que dava para
melhorar é o **diagnóstico**: `Cannot find module .../dist/errors/index.mjs` não
diz nem que houve uma janela, nem o que a abriu, e manda o leitor investigar o
pacote em vez do ambiente.

`fixtures/built-package.ts` agora envolve os dois carregadores (`importBuilt` e
`requireBuilt`). Quando um entry não carrega, a mensagem nomeia a causa:

```
dist/errors/index.mjs did not load, although dist/ was present when this suite started.
Most likely a `pnpm build` ran against this working tree WHILE the suite was running:
tsup is configured with `clean: true`, so it deletes dist/ before it rewrites it, and a
spec importing inside that window finds nothing. Run the build and the suite one at a
time, or give each its own checkout.
Otherwise the path is wrong, or the build never emitted this entry.
```

O erro original da plataforma é preservado em `cause`, então nada some. Dois
testes em `tests/fixtures/fixture-contracts.spec.ts` cobrem os dois
carregadores.

### O que NÃO foi feito, e por quê

**Retry.** Esperar o arquivo reaparecer (as janelas são de 204 ms e 1,2 s)
deixaria a suíte imune ao build concorrente. Não foi feito por duas razões: (a)
mascararia o caso legítimo de "esqueci de buildar", que hoje falha rápido e
claro; (b) reintroduziria dependência de tempo numa suíte da qual o commit
`4f5786b` acabou de remover exatamente isso. Se você preferir o retry, é uma
mudança pequena e localizada nos dois carregadores — mas é uma troca, não uma
melhoria pura.

---

## 7. Instrumentação deixada armada

O monitor usado nos dois experimentos está versionado em
`docs/tools/watch-dist.mjs`, e é reexecutável a qualquer momento. Fica fora de
`scripts/` de propósito: `vitest.config.ts:20` inclui `scripts/**` na cobertura
com threshold de 100%, e uma ferramenta de diagnóstico manual não tem por que
carregar uma suíte de testes própria.

```bash
node docs/tools/watch-dist.mjs "$PWD" /tmp/dist-events.log 150 &
WATCHER=$!
pnpm coverage
kill $WATCHER
cat /tmp/dist-events.log
```

Ele registra cada aparição, sumiço, mudança de tamanho e mudança de mtime em
`dist/`, com timestamp ISO. Um log vazio significa que a suíte rodou sozinha; um
par `removed=N` / `added=N` a poucas centenas de milissegundos de distância é a
assinatura do `clean: true` do tsup.

Se o sintoma reaparecer, o próprio erro já nomeia a causa (seção 6) — e se o
diagnóstico estiver errado num caso novo, o monitor mostra o momento exato.
