#!/bin/bash

# Initialize Let's Encrypt SSL certificates for Quilltap
# Usage: ./init-letsencrypt.sh <domain> <email>
#
# Example: ./init-letsencrypt.sh quilltap.example.com admin@example.com

set -e

DOMAIN=$1
EMAIL=$2

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "Usage: $0 <domain> <email>"
    echo "Example: $0 quilltap.example.com admin@example.com"
    exit 1
fi

# Configuration
DATA_PATH="./certbot"
RSA_KEY_SIZE=4096
STAGING=${STAGING:-0} # Set to 1 for testing

# Check if certificates already exist
if [ -d "$DATA_PATH/conf/live/$DOMAIN" ]; then
    read -p "Existing certificates found for $DOMAIN. Remove and continue? (y/N) " decision
    if [ "$decision" != "Y" ] && [ "$decision" != "y" ]; then
        exit 0
    fi
fi

# Create directories
mkdir -p "$DATA_PATH/conf/live/$DOMAIN"
mkdir -p "$DATA_PATH/www"

# Download recommended TLS parameters
if [ ! -e "$DATA_PATH/conf/options-ssl-nginx.conf" ] || [ ! -e "$DATA_PATH/conf/ssl-dhparams.pem" ]; then
    echo "### Downloading recommended TLS parameters..."
    curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf > "$DATA_PATH/conf/options-ssl-nginx.conf"
    curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem > "$DATA_PATH/conf/ssl-dhparams.pem"
    echo
fi

# Create dummy certificate for nginx to start
echo "### Creating dummy certificate for $DOMAIN..."
CERT_PATH="/etc/letsencrypt/live/$DOMAIN"
mkdir -p "$DATA_PATH/conf/live/$DOMAIN"
docker compose -f docker-compose.prod.yml run --rm --entrypoint "\
    openssl req -x509 -nodes -newkey rsa:$RSA_KEY_SIZE -days 1 \
    -keyout '$CERT_PATH/privkey.pem' \
    -out '$CERT_PATH/fullchain.pem' \
    -subj '/CN=localhost'" certbot
echo

# Start nginx
echo "### Starting nginx..."
docker compose -f docker-compose.prod.yml up --force-recreate -d nginx
echo

# Delete dummy certificate
echo "### Deleting dummy certificate for $DOMAIN..."
docker compose -f docker-compose.prod.yml run --rm --entrypoint "\
    rm -Rf /etc/letsencrypt/live/$DOMAIN && \
    rm -Rf /etc/letsencrypt/archive/$DOMAIN && \
    rm -Rf /etc/letsencrypt/renewal/$DOMAIN.conf" certbot
echo

# Request Let's Encrypt certificate
echo "### Requesting Let's Encrypt certificate for $DOMAIN..."
# Join $DOMAIN to -d args
DOMAIN_ARGS="-d $DOMAIN"

# Select appropriate email arg
CASE_ARG=""
if [ $STAGING != "0" ]; then
    CASE_ARG="--staging"
fi

docker compose -f docker-compose.prod.yml run --rm --entrypoint "\
    certbot certonly --webroot -w /var/www/certbot \
    $CASE_ARG \
    $DOMAIN_ARGS \
    --email $EMAIL \
    --rsa-key-size $RSA_KEY_SIZE \
    --agree-tos \
    --force-renewal" certbot
echo

# Reload nginx
echo "### Reloading nginx..."
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
echo

echo "### Certificate successfully obtained!"
echo "### Your site is now available at: https://$DOMAIN"
