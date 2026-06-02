import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { PrismaService } from '../../../prisma/prisma.service';
import { ThreadsTopicService } from './threads-topic.service';

@Injectable()
export class DiscordService implements OnModuleInit {
  private readonly logger = new Logger(DiscordService.name);
  private client: Client;
  private channelId = process.env.DISCORD_CHANNEL_ID;

  constructor(
    private readonly prisma: PrismaService,
    private readonly threadsTopicService: ThreadsTopicService,
  ) {
    // Khai báo thêm quyền Đọc tin nhắn (MessageContent)
    this.client = new Client({ 
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
      ] 
    });
  }

  async onModuleInit() {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      this.logger.warn('⚠️ Chưa cấu hình DISCORD_BOT_TOKEN trong file .env');
      return;
    }

    this.client.once('ready', () => {
      this.logger.log(`🎮 Discord Bot đã online với tên: ${this.client.user?.tag}`);
    });

    // ====================================================================
    // 1. TÍNH NĂNG TẠO VIDEO THỦ CÔNG: NHẬN LINK TRỰC TIẾP TỪ CHAT DISCORD
    // ====================================================================
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;

      const urlRegex = /(https:\/\/www\.threads\.(net|com)\/[^\s]+)/;
      const match = message.content.match(urlRegex);

      if (match) {
        // GỌT SẠCH CÁC KÝ TỰ RÁC Ở CUỐI LINK (như ] ) ' " , .)
        const url = match[0].replace(/[\]\)',"\.]+$/, '');

        const reply = await message.reply('⏳ **Đã nhận link!** Đang gọi AI mổ xẻ và xả khói Render video thủ công...');
        
        try {
          this.logger.log(`🛠️ Bắt đầu xử lý thủ công từ Discord cho URL chuẩn: ${url}`);
          const res = await this.threadsTopicService.processThreadsVideo(url);
          
          await reply.edit(`✅ **RENDER THÀNH CÔNG!**\n🎥 Tên video: \`${res?.videoName}\``);
        } catch (err: any) {
          await reply.edit(`❌ **LỖI RENDER THỦ CÔNG:** ${err.message}`);
        }
      }
    });

    // ====================================================================
    // 2. TÍNH NĂNG DUYỆT BÀI TỰ ĐỘNG (LẮNG NGHE SỰ KIỆN BẤM NÚT)
    // ====================================================================
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton()) return;

      const [action, postId] = interaction.customId.split('_');

      try {
        const post = await this.prisma.threadPost.findUnique({ where: { id: postId } });
        if (!post) {
          await interaction.reply({ content: '❌ Bài viết không còn tồn tại trong kho!', ephemeral: true });
          return;
        }

        if (action === 'approve') {
          await interaction.update({ components: [] }); 
          const msg = await interaction.followUp(`🎬 **ĐÃ DUYỆT!** Đang xả khói Render video cho bài của \`${post.author}\`...`);

          await this.prisma.threadPost.update({ where: { id: postId }, data: { isApproved: true } });
          
          this.threadsTopicService.processThreadsVideo(post.url).then(async (res) => {
            await msg.edit(`✅ **RENDER THÀNH CÔNG!** Video: \`${res?.videoName}\``);
            await this.prisma.threadPost.update({ where: { id: postId }, data: { isRendered: true } });
          }).catch(async (err) => {
            await msg.edit(`❌ **RENDER THẤT BẠI:** ${err.message}`);
          });

        } else if (action === 'reject') {
          await this.prisma.threadPost.delete({ where: { id: postId } });
          await interaction.update({ content: '🗑️ *Đã ném bài này vào sọt rác!*', embeds: [], components: [] });
        }
      } catch (error: any) {
        this.logger.error(`Lỗi Discord Interaction: ${error.message}`);
      }
    });

    await this.client.login(token);
  }

  // ... (Giữ nguyên hàm sendPostToReview bên dưới) ...
  async sendPostToReview(post: any) {
    if (!this.client.isReady() || !this.channelId) return;
    try {
      const channel = await this.client.channels.fetch(this.channelId);
      if (!channel || !channel.isTextBased()) return;

      const embed = new EmbedBuilder()
        .setColor(post.aiScore >= 9 ? 0xFF0000 : 0x00FF00)
        .setTitle(`🔥 [${post.aiScore}/10] CẢM XÚC: ${post.vibe?.toUpperCase()}`)
        .setURL(post.url)
        .setAuthor({ name: post.author, iconURL: post.avatarUrl || undefined })
        .setDescription(`>>> ${post.content.substring(0, 300)}${post.content.length > 300 ? '...' : ''}`)
        .setFooter({ text: `ID: ${post.id}` });

      if (post.attachedImg) embed.setImage(post.attachedImg);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`approve_${post.id}`).setLabel('🎬 LÊN VIDEO!').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`reject_${post.id}`).setLabel('🗑️ Vứt').setStyle(ButtonStyle.Danger),
      );

      // @ts-ignore
      await channel.send({ embeds: [embed], components: [row] });
    } catch (error: any) {
      this.logger.error(`Lỗi bắn tin Discord: ${error.message}`);
    }
  }
}