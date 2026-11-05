---
description: Registra a sessão atual no vault de conhecimento da ByTech-3
---
1. Se ../bytech3-brain não existir, clone https://github.com/ByTech-3/bytech3-brain.git em ../bytech3-brain. Se existir, git pull.
2. Siga as regras do ../bytech3-brain/bytech3-brain/CLAUDE.md (o vault fica na subpasta bytech3-brain/ do repositório).
3. Crie ../bytech3-brain/bytech3-brain/04-Sessoes-IA/claude-code/AAAA-MM-DD-<slug>.md usando ../bytech3-brain/bytech3-brain/06-Templates/sessao-ia.md.
4. Preencha: objetivo, o que foi feito, decisões, arquivos alterados e pendências. Ligue projeto e cliente com [[ ]].
5. Se a sessão mudou algo importante de um projeto ou cliente, atualize também a nota dele.
6. Em ../bytech3-brain: git add . && git commit -m "sessao: <slug>" && git pull --rebase && git push
Contexto extra: $ARGUMENTS
