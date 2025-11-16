FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and config
COPY . .

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 3000

# Start the application
# Use --env-file if .env exists, otherwise use environment variables from runtime
CMD ["sh", "-c", "if [ -f .env ]; then node --env-file=.env dist/index.js; else node dist/index.js; fi"]

