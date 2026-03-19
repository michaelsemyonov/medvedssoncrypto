install:
	pnpm install

dev:
	pnpm dev

dev-api:
	pnpm dev:api

dev-pwa:
	pnpm dev:pwa

migrate:
	pnpm db:migrate

typecheck:
	pnpm typecheck

test:
	pnpm test

compose-up:
	docker compose up --build

compose-down:
	docker compose down
