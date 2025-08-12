# Use nginx as the base image for serving static files
FROM nginx:alpine

# Remove default nginx website
RUN rm -rf /usr/share/nginx/html/*

# Copy our shopping list app to nginx html directory
COPY shopping-list.html /usr/share/nginx/html/index.html

# Copy any additional static files if needed
COPY . /usr/share/nginx/html/

# Create a custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]