FROM node:23.10-alpine

WORKDIR /app

# Install dependencies first (for better layer caching)
COPY package*.json ./
RUN npm install

# Copy application files
COPY . .

# Create uploads directory if it doesn't exist
RUN mkdir -p uploads

# Expose ports
EXPOSE 3000
EXPOSE 9999

# Start the application
CMD ["node", "server.js"]
