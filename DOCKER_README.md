# Docker Setup Guide

## Prerequisites

- Docker installed
- `.env` file configured with all required environment variables (or use environment variables directly)

## Environment Variables

Create a `.env` file in the root directory with:

```env
# Server
PORT=3000
FRONTEND_URL=http://localhost:3000

# Database (use your external database host)
DB_HOST=your_db_host
DB_PORT=5432
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_db_name

# AI Services
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

## Quick Start

### Build the Docker Image

```bash
docker build -t wyvate-agent-kit .
```

### Run the Container

#### Option 1: Using .env file

```bash
docker run -d \
  --name wyvate-agent-kit \
  -p 3000:3000 \
  --env-file .env \
  wyvate-agent-kit
```

#### Option 2: Using environment variables directly

```bash
docker run -d \
  --name wyvate-agent-kit \
  -p 3000:3000 \
  -e PORT=3000 \
  -e FRONTEND_URL=http://localhost:3000 \
  -e DB_HOST=your_db_host \
  -e DB_PORT=5432 \
  -e DB_USER=your_db_user \
  -e DB_PASSWORD=your_db_password \
  -e DB_NAME=your_db_name \
  -e GEMINI_API_KEY=your_gemini_api_key \
  -e GOOGLE_MAPS_API_KEY=your_google_maps_api_key \
  wyvate-agent-kit
```

### View Logs

```bash
docker logs -f wyvate-agent-kit
```

### Stop Container

```bash
docker stop wyvate-agent-kit
```

### Remove Container

```bash
docker rm wyvate-agent-kit
```

### Rebuild After Code Changes

```bash
docker build -t wyvate-agent-kit .
docker stop wyvate-agent-kit
docker rm wyvate-agent-kit
docker run -d --name wyvate-agent-kit -p 3000:3000 --env-file .env wyvate-agent-kit
```

## Production Deployment

1. Set `FRONTEND_URL` in `.env` to your frontend domain
2. Update database connection to your production database
3. Build and run:

```bash
docker build -t wyvate-agent-kit .
docker run -d \
  --name wyvate-agent-kit \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  wyvate-agent-kit
```

## Health Check

Test the API:

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d "\"I am in Kanpur, show me nearby vendors\""
```

## Troubleshooting

### View logs
```bash
docker logs -f wyvate-agent-kit
```

### Access container shell
```bash
docker exec -it wyvate-agent-kit sh
```

### Rebuild after code changes
```bash
docker build -t wyvate-agent-kit .
docker stop wyvate-agent-kit
docker rm wyvate-agent-kit
docker run -d --name wyvate-agent-kit -p 3000:3000 --env-file .env wyvate-agent-kit
```

