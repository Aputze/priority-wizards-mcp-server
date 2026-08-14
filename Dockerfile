# Priority Wizards MCP Server - HTTP mode for Docker / Jeen
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
RUN apk upgrade --no-cache && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY src ./src
ENV PORT=3002 HOST=0.0.0.0 WIZ1_DIR=/data/wiz1 WIZ1_HHC=/data/wiz1/WIZ1.hhc WIZ3_DIR=/data/wiz3 WIZ3_HHC=/data/wiz3/WIZ3.hhc
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js", "--http"]