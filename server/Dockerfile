# Container for the Munchie Mayhem game server (Cloud Run, Fly, Render, ECS...).
# Built from the REPO ROOT, because the server imports the shared simulation
# from ../src:   docker build -f server/Dockerfile -t munchie-server .
FROM node:22-slim

WORKDIR /app

# `ws` is the only runtime dependency the server needs. It lives in
# devDependencies (the browser game itself has zero runtime deps), so
# install it explicitly rather than running a full `npm ci`.
COPY package.json ./
RUN npm install ws --omit=dev --no-audit --no-fund

# The server shares the simulation with the client - same rules, one copy.
COPY src ./src
COPY config ./config
COPY server ./server

# Cloud Run injects PORT; this is only the documented default.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/node-server.mjs"]
