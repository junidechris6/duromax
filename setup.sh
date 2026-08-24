#!/bin/bash
# Duro-Max Automated Ubuntu VPS Setup Script
# Installs Node.js, Git, Chromium, PM2, configures .env, and starts the server.

echo "=================================================="
echo "🚀 Starting Duro-Max Server Setup on Ubuntu..."
echo "=================================================="

# 1. Update system packages
echo "[1/6] Updating system packages..."
sudo apt-get update -y

# 2. Install Node.js 20 and Git
echo "[2/6] Installing Node.js and Git..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 3. Install Chromium and Puppeteer dependencies
echo "[3/6] Installing Chromium and browser dependencies..."
sudo apt-get install -y chromium-browser libnss3 libatk-bridge2.0-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 libatk1.0-0 libcups2 || \
sudo apt-get install -y chromium libnss3 libatk-bridge2.0-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 libatk1.0-0 libcups2

# 4. Clone the repository
echo "[4/6] Cloning the code from GitHub..."
cd ~
rm -rf duromax
git clone https://github.com/junidetouro7-byte/duromaxuuuuuuuuuu.git duromax
cd duromax

# 5. Configure local environment variables
echo "[5/6] Creating .env file..."
CHROMIUM_PATH=$(which chromium-browser || which chromium || echo "/usr/bin/chromium-browser")
cat <<EOF > .env
EMAIL_USER=duromaxofficial@gmail.com
EMAIL_PASS=glsweejsmvonvdum
PORT=80
PUPPETEER_EXECUTABLE_PATH=$CHROMIUM_PATH
EOF

# Install npm dependencies
echo "Installing application dependencies..."
npm install

# 6. Install PM2 and Start the App
echo "[6/6] Configuring background runner (PM2)..."
sudo npm install -g pm2
pm2 delete duromax 2>/dev/null || true
pm2 start server.js --name "duromax"

# Configure startup on reboot
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME
pm2 save

echo "=================================================="
echo "✅ Duro-Max Website is now running in the background!"
echo "--------------------------------------------------"
echo "Public Website: http://<YOUR_VPS_IP>"
echo "WhatsApp Link Page: http://<YOUR_VPS_IP>/qr"
echo "=================================================="
