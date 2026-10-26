#!/usr/bin/env bash

if [ -n "$1" ]; then
    exec "$@"
fi

cp /usr/share/nginx/html/empty.html /usr/share/nginx/html/eum.html
chmod 644 /usr/share/nginx/html/eum.html

envsubst '${CATALOGUE_HOST} ${USER_HOST} ${CART_HOST} ${SHIPPING_HOST} ${PAYMENT_HOST} ${RATINGS_HOST}' \
    < /etc/nginx/conf.d/default.conf.template \
    > /etc/nginx/conf.d/default.conf

exec nginx-debug -g "daemon off;"