# Use nginx as the base image for serving static files
FROM nginx:alpine

# Remove default nginx website
RUN rm -rf /usr/share/nginx/html/*

# Copy our shopping list app files to nginx html directory
COPY frontend/index.html /usr/share/nginx/html/index.html
COPY frontend/shared.html /usr/share/nginx/html/shared.html
COPY frontend/shopping-list.html /usr/share/nginx/html/shopping-list.html
COPY frontend/styles.css /usr/share/nginx/html/styles.css
COPY frontend/script.js /usr/share/nginx/html/script.js

# Create a custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]