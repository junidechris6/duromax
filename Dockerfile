FROM node:20-slim

# Install system dependencies for headless Chrome/Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libcups2 \
    libxcursor1 \
    libxss1 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0 \
    libcairo2 \
    libdbus-1-3 \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install app dependencies (will trigger postinstall to download Chrome)
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Start server (Railway injects $PORT automatically)
CMD ["npm", "start"]
