FROM node:18-alpine

# Cài đặt FFmpeg (Bắt buộc cho hệ thống)
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Generate Prisma Client
RUN npx prisma generate

RUN npm run build

CMD ["npm", "run", "start:prod"]