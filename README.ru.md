<div align="center">

<img src="https://raw.githubusercontent.com/legolev/mediamcp/main/assets/banner.png" alt="mediamcp" width="100%" />

### Научите любого ИИ-агента создавать изображения и видео

**mediamcp** — это MCP-сервер, который соединяет вашего ИИ-ассистента — Claude Code, Claude Desktop,<br/>
Cursor, Windsurf, VS Code или любой другой клиент с поддержкой MCP — с облачными медиамоделями<br/>
(Gemini Flash Image, GPT-5 Image, Seedream, Veo, Sora, …) через [OpenRouter](https://openrouter.ai) или любой OpenAI-совместимый API.

[![npm version](https://img.shields.io/npm/v/mediamcp)](https://www.npmjs.com/package/mediamcp)
[![CI](https://github.com/legolev/mediamcp/actions/workflows/ci.yml/badge.svg)](https://github.com/legolev/mediamcp/actions/workflows/ci.yml)
[![node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | **Русский**

<sub>⭐ Баннер выше сгенерирован самим mediamcp — один вызов `generate_image`.</sub>

</div>

---

Сгенерированные файлы всегда сохраняются на диск (по умолчанию в `~/Pictures/mediamcp`), а каждый ответ содержит абсолютный путь к файлу и небольшое встроенное превью — агент сразу видит, что у него получилось.

> **ИИ-агентам:** инструкция по установке, оптимизированная специально для вас, лежит в [llms-install.md](llms-install.md).

**Вам понадобится API-ключ OpenRouter** — получить его можно на <https://openrouter.ai/keys>.

## Быстрая установка

### Claude Code

```bash
claude mcp add mediamcp -e OPENROUTER_API_KEY=sk-or-v1-YOUR_KEY -- npx -y mediamcp
```

### Claude Desktop

Добавьте в `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows: `%APPDATA%\Claude\claude_desktop_config.json`) и перезапустите Claude Desktop:

```json
{
  "mcpServers": {
    "mediamcp": {
      "command": "npx",
      "args": ["-y", "mediamcp"],
      "env": { "OPENROUTER_API_KEY": "sk-or-v1-YOUR_KEY" }
    }
  }
}
```

### Cursor

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=mediamcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1lZGlhbWNwIl0sImVudiI6eyJPUEVOUk9VVEVSX0FQSV9LRVkiOiJZT1VSX09QRU5ST1VURVJfS0VZIn19)

Или добавьте в `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mediamcp": {
      "command": "npx",
      "args": ["-y", "mediamcp"],
      "env": { "OPENROUTER_API_KEY": "sk-or-v1-YOUR_KEY" }
    }
  }
}
```

### Windsurf

Добавьте в `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "mediamcp": {
      "command": "npx",
      "args": ["-y", "mediamcp"],
      "env": { "OPENROUTER_API_KEY": "sk-or-v1-YOUR_KEY" }
    }
  }
}
```

### VS Code (GitHub Copilot)

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_mediamcp-0098FF?logo=githubcopilot)](https://vscode.dev/redirect/mcp/install?name=mediamcp&config=%7B%22name%22%3A%22mediamcp%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22mediamcp%22%5D%2C%22env%22%3A%7B%22OPENROUTER_API_KEY%22%3A%22YOUR_OPENROUTER_KEY%22%7D%7D)

Или добавьте в `.vscode/mcp.json` (ключ запрашивается отдельно и не попадает в файл):

```json
{
  "servers": {
    "mediamcp": {
      "command": "npx",
      "args": ["-y", "mediamcp"],
      "env": { "OPENROUTER_API_KEY": "${input:openrouter-key}" }
    }
  },
  "inputs": [
    {
      "id": "openrouter-key",
      "type": "promptString",
      "password": true,
      "description": "OpenRouter API key (https://openrouter.ai/keys)"
    }
  ]
}
```

## Что сможет делать ваш агент

После установки просто скажите агенту что-нибудь вроде *«сгенерируй hero-изображение для моего лендинга, 16:9»*, *«убери фон с logo.png»* или *«сделай 8-секундное видео с океанскими волнами на закате»*. Агент сам выберет подходящий инструмент:

| Инструмент | Что делает |
| --- | --- |
| `generate_image` | Текст → изображение (одно или несколько). Сохраняет на диск, возвращает путь и встроенное превью. Поддерживает `count` (до 4 вариаций), `aspect_ratio` и переопределение `model`. |
| `edit_image` | Существующее изображение (одно или несколько) + инструкция → отредактированное изображение. Принимает пути к файлам, `https://`- и `data:`-URL; несколько источников — для объединения изображений в одну композицию. |
| `generate_video` | Текст → видео (асинхронная задача, обычно 1–5 минут). Дожидается результата, сохраняет mp4, возвращает путь. При таймауте возвращает `polling_url`, по которому ожидание можно возобновить. |
| `check_video_status` | Возобновляет ожидание видеозадачи по `polling_url` / id; по готовности скачивает результат. |
| `list_models` | Выводит слаги и цены моделей с поддержкой изображений/видео — агент сможет сам подобрать модель. |
| `check_config` | Диагностика: наличие и валидность ключа, эндпоинт, значения по умолчанию, возможность записи в каталог вывода. Если что-то не работает — запускайте его первым. |

## Конфигурация

Всё настраивается через переменные окружения в блоке `env` конфигурации вашего MCP-клиента:

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | — | **Обязательна.** Ваш ключ OpenRouter. |
| `MEDIAMCP_API_KEY` | — | Псевдоним `OPENROUTER_API_KEY` для эндпоинтов, отличных от OpenRouter; имеет приоритет, если заданы обе переменные. |
| `MEDIAMCP_BASE_URL` | `https://openrouter.ai/api/v1` | Корневой URL любого OpenAI-совместимого API. |
| `MEDIAMCP_MODEL` | `google/gemini-2.5-flash-image` | Слаг модели изображений по умолчанию. |
| `MEDIAMCP_VIDEO_MODEL` | `google/veo-3.1` | Слаг видеомодели по умолчанию. |
| `MEDIAMCP_OUTPUT_DIR` | `~/Pictures/mediamcp` | Куда сохранять сгенерированные файлы (`~/mediamcp`, если `~/Pictures` не существует). |
| `MEDIAMCP_TIMEOUT_MS` | `120000` | HTTP-таймаут на один запрос. |
| `MEDIAMCP_PREVIEW` | `true` | Возвращать встроенное превью вместе с каждым результатом (`false` — только пути). |
| `MEDIAMCP_PREVIEW_MAX_DIM` | `768` | Длинная сторона встроенного превью в пикселях. |

### Использование другого провайдера

Укажите в `MEDIAMCP_BASE_URL` любой OpenAI-совместимый эндпоинт и задайте соответствующий ключ:

```json
"env": {
  "MEDIAMCP_BASE_URL": "https://your-endpoint.example.com/v1",
  "MEDIAMCP_API_KEY": "your-key",
  "MEDIAMCP_MODEL": "your/image-model"
}
```

mediamcp сам определяет, какой формат API поддерживает эндпоинт: выделенный эндпоинт `/images` (OpenRouter), `/images/generations` (классический OpenAI) или `chat/completions` с поддержкой изображений — первый сработавший вариант запоминается.

## Диагностика проблем

1. Попросите агента запустить инструмент **`check_config`** — он сообщит, что именно настроено неверно и как это исправить.
2. Ту же диагностику можно запустить из терминала: `npx -y mediamcp --check` (используются переменные окружения вашей оболочки).
3. Типичные проблемы:
   - **«No API key configured»** — добавьте `OPENROUTER_API_KEY` в блок `env` записи сервера в конфигурации MCP-клиента (а не только в профиль оболочки) и перезапустите клиент.
   - **«Out of credits (HTTP 402)»** — пополните баланс на <https://openrouter.ai/credits>.
   - **«Not found (HTTP 404) … for model»** — неверный слаг модели; запустите `list_models`.
   - **В клиенте ничего не происходит** — убедитесь, что установлен Node.js ≥ 20 (`node --version`).

## Разработка

```bash
git clone https://github.com/legolev/mediamcp && cd mediamcp
npm install
npm run build       # сборка в dist/index.js
npm test            # юнит-тесты (vitest)
npm run inspect     # открыть MCP Inspector с собранным сервером
```

## Лицензия

[MIT](LICENSE)
