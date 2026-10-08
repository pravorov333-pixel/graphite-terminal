# Graphite — browser version of the terminal (same UI as the Electron app), served by server.js.
#   docker build -t graphite .
#   docker run --rm -p 8080:8080 graphite      → open http://localhost:8080
FROM node:22-alpine
WORKDIR /app
# only the runtime dependency (lightweight-charts); Electron is a dev dependency and is not installed here
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY index.html styles.css server.js manifest.webmanifest ./
COPY src ./src
COPY build ./build
ENV HOST=0.0.0.0 PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.js"]
