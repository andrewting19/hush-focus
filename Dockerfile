FROM node:22-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace config and lockfile
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy package.json files for all packages
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server

# Build
RUN pnpm --filter claude-blocker build

EXPOSE 8765

CMD ["node", "packages/server/dist/bin.js", "--skip-setup"]
