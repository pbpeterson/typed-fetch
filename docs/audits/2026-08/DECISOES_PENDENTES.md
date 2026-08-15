# Decisões pendentes

> **RESOLVIDO em 2026-08-15.** Os três itens foram decididos e implementados no
> mesmo branch que criou este arquivo. O documento fica como registro do que foi
> escolhido e por quê; ele não é mais uma lista de trabalho a fazer.
>
> | #   | Decisão                                                       | Onde ficou                                                   |
> | --- | ------------------------------------------------------------- | ------------------------------------------------------------ |
> | 1   | Opção A — documentar no JSDoc, com orientação de `bind`/arrow | `src/request-plan.ts`, commit `99bfb61`                      |
> | 2   | Opção A — documentar como diferença de runtime                | `README.md`, commit `5dd5b3b`                                |
> | 3   | Opção A + C — documentar e travar com gate                    | `README.md` e `scripts/check-consumer.mjs`, commit `b249524` |
>
> As referências `arquivo:linha` abaixo apontam para o estado ANTERIOR às
> correções e não valem mais como localização — só como descrição do defeito.

Três itens da auditoria de pré-publicação precisavam de uma decisão. Cada um
traz o estado que tinha na época, as opções com prós e contras, e a
recomendação que foi seguida.

Contexto: os itens 1 e 2 são de documentação e não mudam código publicado. O
item 3 é uma escolha de compatibilidade num pacote já publicado, e o
`docs/audit-ledger.md` já o registra como "OPEN, and a maintainer's decision
rather than a defect to fix quietly".

---

## 1. A regra de own-property do `fetch`: documentar ou validar em runtime?

**Estado atual.** `typedFetch` lê a opção `fetch` como propriedade **própria**
de `options`. Um `fetch` herdado do protótipo é ignorado em silêncio e a
requisição vai para o `fetch` global — com os headers do chamador.

A regra é deliberada e existe por segurança: fecha o vetor
`Object.prototype.fetch = evil`, que redirecionaria toda requisição do processo
(`README.md:800`). O `README.md:777-782` explica tudo. O JSDoc publicado, que é
o que o dev lê no IntelliSense, é uma linha só:

```
src/request-plan.ts:357  /** Override the fetch implementation (testing, DI, custom agents). */
```

Reprodução: `Object.create({ fetch })` e um método `fetch` numa classe passada
como `options` são ambos ignorados, e a chamada sai para a rede de verdade.

### Opção A — só documentar (expandir o JSDoc)

Copiar o parágrafo do README para o JSDoc de `TypedFetchOptions["fetch"]`.
Prós: zero risco, zero custo de runtime, resolve o caso real (dev com DI
baseada em classe descobre a regra onde já está olhando). Não mexe em
comportamento, então é `patch`.
Contras: continua sendo uma falha silenciosa para quem não lê o tooltip.

### Opção B — validar em runtime (avisar quando há `fetch` herdado)

Quando `options` não tem `fetch` próprio mas tem um herdado, emitir um aviso
(ou lançar).
Prós: a falha deixa de ser silenciosa exatamente no caso que dói.
Contras: custa uma leitura a mais do protótipo por chamada, no caminho quente.
Pior: essa leitura é do protótipo do objeto do chamador — a mesma superfície
hostil que a regra existe para não tocar, e um getter hostil no protótipo
passaria a rodar. Lançar seria `major`; avisar polui o stderr de quem usa
`Object.create` legitimamente.

### Recomendação: **Opção A**

A opção B paga custo no caminho quente e volta a tocar a superfície que a regra
foi escrita para evitar, para resolver um problema de descoberta. O problema de
descoberta se resolve onde ele acontece, que é o tooltip.

---

## 2. `UnknownHttpError.statusText` no Deno: documentar, normalizar ou ignorar?

**Estado atual.** O `fetch` do Deno descarta a _reason phrase_ da resposta, e
`response.statusText` volta `""`. Confirmado com `fetch` puro, sem a
biblioteca no meio — a causa é o runtime, não o `typedFetch`.

| Runtime | `statusText` para status 599, phrase "Weird Status" |
| ------- | --------------------------------------------------- |
| Node    | `"Weird Status"`                                    |
| Bun     | `"Weird Status"`                                    |
| Deno    | `""`                                                |

O README afirma sem ressalva que `UnknownHttpError.statusText` é "the reason
phrase the server sent, filtered and bounded" (`README.md:1008`, repetido em
`:293`), lista Deno como runtime suportado (`:40`), e já traz uma nota
equivalente para o Bun em `:492`. Falta a nota análoga para o Deno.

Vale notar que o `RELEASING.md` regra 3 já isenta este campo do contrato:
"`UnknownHttpError` is the one exception, and it is not a promise this package
can make."

### Opção A — documentar (nota igual à do Bun)

Adicionar uma NOTE ao lado da afirmação dizendo que no Deno o campo vem vazio,
porque o runtime não expõe a reason phrase.
Prós: honesto, consistente com o tratamento que o Bun já recebe, `patch`, e
alinhado com a regra 3, que já diz que o campo não é promessa da biblioteca.
Contras: nenhum além do texto a mais.

### Opção B — normalizar (inventar um label quando vier vazio)

Preencher `statusText` com um label canônico quando o runtime não der nada.
Prós: o campo passa a ter valor em todo runtime.
Contras: `UnknownHttpError` existe justamente porque o status **não tem** label
canônico — é o que a regra 3 diz. Preencher inventa um dado que o servidor não
mandou e que a biblioteca não pode conhecer, e apaga a diferença entre "o
servidor não mandou phrase" e "o runtime jogou fora". Muda um campo que É do
contrato nas outras 40 classes, então é `minor` no mínimo.

### Opção C — ignorar

Prós: nenhum trabalho.
Contras: quem depende do campo no Deno recebe string vazia sem aviso, e o
README lista Deno como suportado. É uma afirmação falsa num runtime que o
próprio README promete.

### Recomendação: **Opção A**

A biblioteca está correta; só a documentação promete demais. A opção B
contradiz a regra 3 do próprio `RELEASING.md` e inventa dado.

---

## 3. Divergência CJS/ESM de `constructor.name`: corrigir a paridade ou documentar?

**Estado atual.** `tsup.config.ts:19` liga `splitting: true`, que é o que dá
`instanceof` entre os entry points `.` e `./errors` dentro de um mesmo formato.
No lado CJS o tsup passa pelo Sucrase, que rebaixa class fields
incondicionalmente. Duas consequências chegam a quem usa `require()`:

- **44 das 45 classes exportadas perdem o `Class.name`**: `NotFoundError.name`
  é `"_class9"`, e `error.constructor.name` junto. O `error.name` da instância
  continua correto nos dois formatos, então o contrato de semver sobre
  `error.name` se mantém — `Class.name` não é coberto por ele de qualquer jeito.
- **Uma subclasse do consumidor com accessor em `name`, `status` ou
  `statusText` lança sob `require()` e funciona sob `import`**, porque os campos
  viram `[[Set]]` em vez de `[[Define]]`. Esse é o ponto de extensão documentado.

Ambos reproduzem contra o tarball instalado. Nenhum gate pegou: todo spec de
raiz importa `src/`, o snapshot de superfície compara **nomes** de export, e o
`check-consumer` lê só o `error.name` da instância.

`docs/audit-ledger.md:427-449` já registra isso e enumera as opções abaixo.

### Opção A — manter `splitting: true` e documentar as duas consequências

Prós: `instanceof` entre entry points continua funcionando em CJS; nenhuma
mudança no artefato publicado; é `patch`. O README ganha a ressalva que hoje
não existe.
Contras: a subclasse com accessor continua lançando sob `require()`, e é o
ponto de extensão que a documentação oferece.

### Opção B — desligar `splitting` e perder `instanceof` cross-entry em CJS

Prós: `Class.name` volta nos dois formatos e a subclasse com accessor passa a
funcionar sob `require()`.
Contras: quem faz `require("@pbpeterson/typed-fetch/errors")` e
`require("@pbpeterson/typed-fetch")` passa a ter duas cópias das classes, e
`instanceof` entre elas quebra. A biblioteca já recomenda os type guards por
brand, que não são afetados — mas é uma quebra observável em CJS, ou seja,
`major`.

### Opção C — manter `splitting` e adicionar um gate que trave a divergência

Fazer o `check-consumer` ler `error.constructor.name` e exercitar a subclasse
com accessor nos dois formatos, para que a divergência pare de crescer em
silêncio.
Prós: fecha o buraco que deixou isso passar; combina com A ou B.
Contras: não resolve nada sozinho — só congela o estado atual.

### Recomendação: **A + C**

A opção B troca uma divergência cosmética (`Class.name`) mais um ponto de
extensão pouco usado por uma quebra de `instanceof` em CJS, que é o caso comum.
Documentar (A) e travar com gate (C) mantém o artefato publicado e impede que a
próxima divergência apareça sem ninguém ver. Se a subclasse com accessor for um
caso real do seu uso, aí B vira a escolha certa — mas é `major`, e precisa
entrar num ciclo de release próprio.

---

## Resumo

| #   | Item                          | Recomendação                          | Impacto semver |
| --- | ----------------------------- | ------------------------------------- | -------------- |
| 1   | Regra own-property do `fetch` | Documentar no JSDoc                   | `patch`        |
| 2   | `statusText` no Deno          | Documentar (nota igual à do Bun)      | `patch`        |
| 3   | `constructor.name` CJS/ESM    | Documentar + gate no `check-consumer` | `patch`        |

Nenhuma recomendação exigiu `minor` ou `major`. As três entraram no mesmo ciclo
de documentação, um commit cada, e estão no branch `fix/pre-publicacao`.
