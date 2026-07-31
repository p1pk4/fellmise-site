# Бэкапы репозитория

**Куда:** `D:\Dev\fellmise_site-backups\` — папка-сосед рядом с проектом, вне
рабочего дерева и вне git. Схема взята с `C:\Dev\dnd-game-backups`: в проекте
такого файла не было, и конвенция зафиксирована здесь по уже сложившейся у
соседнего проекта.

**Что:** git-бандл со **всеми** ветками (`git bundle create … --all`), рядом —
текстовый снимок ссылок на момент снятия. Бандл самодостаточен: из него
клонируется полный репозиторий, включая ветки, которых уже нет на origin.

**Когда обязательно:** перед любой операцией, переписывающей историю
(`filter-repo`, `rebase` опубликованных коммитов, `push --force*`), и перед
удалением веток с приёмочными материалами.

**Имя:** `YYYY-MM-DD_короткая-причина.bundle` плюс `.refs.txt` тем же именем.

## Снять

```
git bundle create D:\Dev\fellmise_site-backups\$(date +%Y-%m-%d)_причина.bundle --all
git for-each-ref --format='%(refname:short) %(objectname:short)' refs/heads refs/remotes ^
  > D:\Dev\fellmise_site-backups\$(date +%Y-%m-%d)_причина.refs.txt
```

## Проверить

```
git bundle verify D:\Dev\fellmise_site-backups\<файл>.bundle
```

Должно сказать `The bundle records a complete history`.

## Восстановить

```
git clone D:\Dev\fellmise_site-backups\<файл>.bundle restored
cd restored && git branch -a
```

Ветки из бандла приедут как `origin/*`; нужную поднять `git checkout -b <имя> origin/<имя>`.

## Что лежит

| Файл | Причина | HEAD на момент снятия |
|---|---|---|
| `2026-07-31_before-history-cleanup.bundle` | перед вырезанием `out/` из истории `main` (скрин-пакет, 153 МБ) и последующей дочисткой `journey3/node_modules` и `journey3/dist` | `9a22f83`, main / polish-review `4ea22dc` / journey-v2 `5c1dffa` |

Старые бандлы не удалять, пока идёт приёмка соответствующего этапа: в них
единственная копия веток, которые могут быть удалены с origin.
