# Priority Wizards MCP Server — HTTP mode for Docker / Jeen
FROM node:22-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application source
COPY src ./src

# Wizard HTML is mounted at runtime (see docker-compose.yml)
ENV PORT=3040 \
    HOST=0.0.0.0 \
    WIZ1_DIR=/data/wiz1 \
    WIZ1_HHC=/data/wiz1/WIZ1.hhc \
    WIZ3_DIR=/data/wiz3 \
    WIZ3_HHC=/data/wiz3/WIZ3.hhc

EXPOSE 3040

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3040)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js", "--http"]
