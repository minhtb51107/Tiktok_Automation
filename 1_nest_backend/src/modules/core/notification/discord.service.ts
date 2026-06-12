import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { PrismaService } from '../../../prisma/prisma.service';

// IMPORT CÁC XƯỞNG CHẾ TÁC:
import { ThreadsDramaService } from '../../workflows/threads-drama/threads-drama.service';
import { ThreadsSeriousService } from '../../workflows/threads-serious/threads-serious.service';
import { ThreadsCompilationService } from '../../workflows/threads-compilation/threads-compilation.service'; 
import { TiktokUploadService } from '../uploader/tiktok-upload.service'; 
import * as fs from 'fs'; 
import * as path from 'path'; 
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Injectable()
export class DiscordService implements OnModuleInit {
  private readonly logger = new Logger(DiscordService.name);
  private client: Client;
  private channelId = process.env.DISCORD_CHANNEL_ID;

  constructor(
    private readonly prisma: PrismaService,
    private readonly threadsDramaService: ThreadsDramaService,
    private readonly threadsSeriousService: ThreadsSeriousService, 
    private readonly threadsCompilationService: ThreadsCompilationService, 
    private readonly tiktokUploadService: TiktokUploadService, 
  ) {
    this.client = new Client({ 
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
      ],
      rest: { timeout: 120000 } 
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

    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;

      if (message.content.trim() === '!ping') {
          await message.reply('🏓 **Pong!** Bot vẫn đang sống và nghe lệnh sếp đây!');
          return;
      }

      // ====================================================================
      // TÍNH NĂNG: TỔNG HỢP NHIỀU LINK THÀNH 1 VIDEO
      // ====================================================================
      const msgTextLower = message.content.trim().toLowerCase();
      if (msgTextLower.startsWith('!mix') || msgTextLower.startsWith('mix!')) {
        const msgText = message.content.trim();
        
        const urls = msgText
            .replace(/^!mix\s*/i, '')
            .replace(/^mix!\s*/i, '')
            .split(/[\s\n]+/)
            .filter(url => url.includes('threads.net') || url.includes('threads.com'));
        
        if (urls.length === 0) {
            await message.reply('❌ Sếp chưa đưa link Threads nào hợp lệ cả!');
            return;
        }

        const reply = await message.reply(`⏳ **Đã nhận lệnh MIX!** Đang gộp ${urls.length} bài viết thành 1 video...`);
        
        try {
            const res = await this.threadsCompilationService.processCompilationVideo(urls, async (status) => {
                await reply.edit(status).catch(() => {});
            });
            
            const videoFilePath = res?.outputPath;

            if (videoFilePath && fs.existsSync(videoFilePath)) {
                 const fileSizeInBytes = fs.statSync(videoFilePath).size;
                 const fileSizeInMB = fileSizeInBytes / (1024 * 1024);

                 if (fileSizeInBytes <= 8 * 1024 * 1024) {
                    await reply.edit('🚀 **BẮT ĐẦU XUẤT XƯỞNG!** Đang upload video lên Discord...');
                    await reply.edit({
                       content: `✅ **MIX THÀNH CÔNG!**\n🎥 Tên file: \`${res?.videoName}\` (Nặng ${fileSizeInMB.toFixed(1)}MB)\n✍️ Caption: \`${res?.caption}\``,
                       files: [videoFilePath]
                    });
                 } else {
                     await reply.edit(`🔄 **Video đang xuất... (Đang nén thêm bản Preview cho Discord vì file gốc nặng tới ${fileSizeInMB.toFixed(1)}MB)**`);
                     const previewPath = await this.createDiscordPreview(videoFilePath);
                     if (previewPath) {
                        await reply.edit({
                            content: `✅ **MIX THÀNH CÔNG!** (Bản Preview xem trước)\n📂 Bản gốc lưu tại máy tính.\n✍️ Caption: \`${res?.caption}\``,
                            files: [previewPath]
                        });
                        setTimeout(() => { if(fs.existsSync(previewPath)) fs.unlinkSync(previewPath); }, 10000);
                    } else {
                        await reply.edit(`✅ **MIX THÀNH CÔNG!** Video quá nặng để ném lên Discord: \`${res?.videoName}\``);
                    }
                 }
            } else {
                 await reply.edit(`✅ **MIX THÀNH CÔNG!** Nhưng không tìm thấy file vật lý.`);
            }
        } catch (err: any) {
             await reply.edit(`❌ **LỖI TỔNG HỢP:** \`${err.message}\``);
        }
        return; 
      }

      // ====================================================================
      // 1. TÍNH NĂNG TẠO VIDEO THỦ CÔNG: NHẬN LINK TRỰC TIẾP TỪ CHAT (1 VIDEO)
      // ====================================================================
      const urlRegex = /(https?:\/\/(?:www\.)?threads\.(net|com)\/[^\s]+)/gi; // <-- Thêm flag 'g' để đếm số link
      const matches = message.content.match(urlRegex);

      if (matches) {
        // 🔥 CẦU CHÌ BẢO VỆ: Chặn ngay nếu gửi nhiều link mà quên lệnh !mix
        if (matches.length > 1) {
            await message.reply('❌ **BÁO ĐỘNG:** Sếp dán nhiều link mà quên ghi chữ `!mix` ở đầu kìa! Bot suýt nữa thì đem đi render từng cái một rồi. Sếp gõ lại lệnh `!mix <link1> <link2>...` để gộp video nhé!');
            return;
        }

        const url = matches[0].replace(/[\]\)',"\.]+$/, '');
        
        const isPodcast = msgTextLower.startsWith('p ') || msgTextLower.startsWith('!p ') || msgTextLower.startsWith('p\n');
        
        const reply = await message.reply(`⏳ **Đã tiếp nhận lệnh!** Đang đưa bài viết vào xưởng chế tác [**${isPodcast ? 'PODCAST NGHIÊM TÚC' : 'DRAMA'}**]...`);
        
        try {
          const renderTask = isPodcast 
            ? this.threadsSeriousService.processSeriousVideo(url, async (status) => { await reply.edit(status).catch(() => {}); })
            : this.threadsDramaService.processDramaVideo(url, async (status) => { await reply.edit(status).catch(() => {}); });
            
          const res = await renderTask;
          
          const videoFilePath = res?.outputPath; 

          if (videoFilePath && fs.existsSync(videoFilePath)) {
             const fileSizeInBytes = fs.statSync(videoFilePath).size;
             const fileSizeInMB = fileSizeInBytes / (1024 * 1024);

             const cleanUrl = url.split('?')[0];
             const uniqueId = `manual_${Date.now()}`;
             const scriptData = res?.script as any;

             const savedPost = await this.prisma.threadPost.create({
                data: {
                   threadId: uniqueId,
                   author: scriptData?.postInfo?.author || scriptData?.post?.author || 'Anonymous',
                   avatarUrl: scriptData?.postInfo?.avatar || scriptData?.post?.avatar || null,
                   content: scriptData?.post?.text || 'Video từ Link thủ công',
                   url: cleanUrl,
                   category: isPodcast ? 'SERIOUS' : 'DRAMA', 
                   caption: res?.caption || 'Video tâm sự #xuhuong #threads',
                   aiScore: 10, 
                   isApproved: true,
                   isRendered: true,
                   isPublished: false
                }
             });

             const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`tiktok_instant_${savedPost.id}`).setLabel('🚀 ĐĂNG TIKTOK NGAY!').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`tiktok_delete_${savedPost.id}_${res?.videoName}`).setLabel('🗑️ XÓA BỎ (RÁC)').setStyle(ButtonStyle.Secondary),
             );

             if (fileSizeInBytes <= 8 * 1024 * 1024) {
                await reply.edit('🚀 **BẮT ĐẦU XUẤT XƯỞNG!** Đang upload video lên Discord...');
                await reply.edit({
                   content: `✅ **XUẤT XƯỞNG VIDEO THÀNH CÔNG!**\n🎥 Tên file: \`${res?.videoName}\` (Nặng ${fileSizeInMB.toFixed(1)}MB)\n✍️ Caption AI: \`${res?.caption}\`\n\nSếp kiểm tra thành phẩm. Nếu ưng ý hãy bấm **ĐĂNG**, nếu video quá chán hãy bấm **XÓA BỎ**:`,
                   files: [videoFilePath],
                   components: [row]
                });
             } else {
                 await reply.edit(`🔄 **Video đang xuất... (Đang nén thêm bản Preview cho Discord vì file gốc nặng tới ${fileSizeInMB.toFixed(1)}MB)**`);
                 const previewPath = await this.createDiscordPreview(videoFilePath);
                 if (previewPath) {
                    await reply.edit({
                        content: `✅ **RENDER THÀNH CÔNG!** (Bản Preview xem trước)\n📂 Bản gốc lưu tại máy tính.\n✍️ Caption: \`${res?.caption || 'Video tâm sự #xuhuong'}\``,
                        files: [previewPath],
                        components: [row]
                    });
                    setTimeout(() => { if(fs.existsSync(previewPath)) fs.unlinkSync(previewPath); }, 10000);
                } else {
                    await reply.edit({ content: `✅ **RENDER THÀNH CÔNG!** Video quá nặng: \`${res?.videoName}\``, components: [row] });
                }
             }
          } else {
             await reply.edit(`✅ **RENDER THÀNH CÔNG!** Nhưng không tìm thấy file vật lý.`);
          }
        } catch (err: any) {
          await reply.edit(`❌ **TIẾN TRÌNH THẤT BẠI!**\n🚨 **Lỗi:** \`${err.message}\``);
        }
      }
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton()) return;
      const parts = interaction.customId.split('_');

      if (parts[0] === 'tiktok' && parts[1] === 'instant') {
          const postId = parts[2];
          await interaction.update({ content: '⚡ **Đang kích hoạt Bot TikTok...** Sếp hãy nhìn vào màn hình máy tính để quét mã QR nhé!', components: [] });
          try {
              await this.tiktokUploadService.uploadPostById(postId);
              await interaction.followUp('🎉 **THÀNH CÔNG MỸ MÃN!** Bot đã đăng xong video lên kênh TikTok của sếp!');
          } catch (err: any) {
              await interaction.followUp(`❌ **ĐĂNG BÀI THẤT BẠI:** \`${err.message}\``);
          }
          return;
      }

      if (parts[0] === 'tiktok' && parts[1] === 'delete') {
          const postId = parts[2];
          const videoName = parts.slice(3).join('_');
          await interaction.update({ content: '🗑️ **Đang dọn dẹp video lỗi vào thùng rác...**', components: [] });
          try {
              await this.prisma.threadPost.delete({ where: { id: postId } }).catch(() => null);
              const videoPath = path.join(process.cwd(), '../3_Storage_Assets/output_ready', videoName);
              if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
              const previewPath = videoPath.replace('.mp4', '_preview.mp4');
              if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath);
              await interaction.editReply('✅ **ĐÃ XÓA SẠCH SẼ!** Giải phóng dung lượng ổ cứng thành công. Database không còn vết tích.');
          } catch (err: any) {
              await interaction.editReply(`❌ **LỖI KHI XÓA RÁC:** ${err.message}`);
          }
          return;
      }

      const action = parts[0];
      const postId = parts[1];

      try {
        const post = await this.prisma.threadPost.findUnique({ where: { id: postId } });
        if (!post) {
          await interaction.reply({ content: '❌ Bài viết không còn tồn tại trong kho!', ephemeral: true });
          return;
        }

        if (action === 'approve') {
          await interaction.update({ components: [] }); 
          const isSerious = (post as any).category === 'SERIOUS';
          const msg = await interaction.followUp(`🎬 **ĐÃ DUYỆT!** Đang xả khói Render video [${isSerious ? 'PODCAST NGHIÊM TÚC' : 'DRAMA'}] cho bài của \`${post.author}\`...`);
          await this.prisma.threadPost.update({ where: { id: postId }, data: { isApproved: true } });
          
          const renderTask = isSerious 
            ? this.threadsSeriousService.processSeriousVideo(post.url, async (status) => { await msg.edit(status).catch(() => {}); })
            : this.threadsDramaService.processDramaVideo(post.url, async (status) => { await msg.edit(status).catch(() => {}); });

          renderTask.then(async (res) => {
             const videoFilePath = res?.outputPath;
             const uploadRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`tiktok_instant_${post.id}`).setLabel('🚀 ĐĂNG TIKTOK NGAY!').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`tiktok_delete_${post.id}_${res?.videoName}`).setLabel('🗑️ XÓA BỎ (RÁC)').setStyle(ButtonStyle.Secondary)
             );

             if (videoFilePath && fs.existsSync(videoFilePath)) {
                 const fileSizeInBytes = fs.statSync(videoFilePath).size;
                 if (fileSizeInBytes <= 8 * 1024 * 1024) {
                    await msg.edit({ content: `✅ **RENDER THÀNH CÔNG!**\n✍️ Caption: \`${res?.caption || 'Video tâm sự #xuhuong'}\``, files: [videoFilePath], components: [uploadRow] });
                 } else {
                    await msg.edit(`🔄 **Video đang xuất... (Đang nén thêm bản Preview cho Discord vì file gốc nặng tới ${(fileSizeInBytes/(1024*1024)).toFixed(1)}MB)**`);
                    const previewPath = await this.createDiscordPreview(videoFilePath);
                    if (previewPath) {
                        await msg.edit({ content: `✅ **RENDER THÀNH CÔNG!** (Bản Preview xem trước)\n📂 Bản gốc lưu tại máy tính.\n✍️ Caption: \`${res?.caption || 'Video tâm sự #xuhuong'}\``, files: [previewPath], components: [uploadRow] });
                        setTimeout(() => { if(fs.existsSync(previewPath)) fs.unlinkSync(previewPath); }, 10000);
                    } else {
                        await msg.edit({ content: `✅ **RENDER THÀNH CÔNG!** Video quá nặng: \`${res?.videoName}\``, components: [uploadRow] });
                    }
                 }
             } else {
                 await msg.edit({ content: `✅ **RENDER THÀNH CÔNG!** Tên file: \`${res?.videoName}\``, components: [uploadRow] });
             }
             
             await this.prisma.threadPost.update({ where: { id: postId }, data: { isRendered: true, caption: res?.caption || post.caption } });
          }).catch(async (err) => { await msg.edit(`❌ **RENDER THẤT BẠI:** ${err.message}`); });

        } else if (action === 'reject') {
          await this.prisma.threadPost.delete({ where: { id: postId } });
          await interaction.update({ content: '🗑️ *Đã ném bài này vào sọt rác!*', embeds: [], components: [] });
        }
      } catch (error: any) { this.logger.error(`Lỗi Discord Interaction: ${error.message}`); }
    });

    await this.client.login(token);
  }

  private async createDiscordPreview(originalPath: string): Promise<string | null> {
    const previewPath = originalPath.replace('.mp4', '_preview.mp4');
    try {
      const ffmpegCmd = `ffmpeg -y -i "${originalPath}" -vf "scale=480:854" -r 24 -c:v libx264 -preset ultrafast -crf 32 -c:a aac -b:a 64k "${previewPath}"`;
      await execAsync(ffmpegCmd);
      if (fs.existsSync(previewPath) && fs.statSync(previewPath).size <= 8 * 1024 * 1024) return previewPath;
      return null;
    } catch (error: any) { return null; }
  }

  async sendPostToReview(post: any) {
    if (!this.client.isReady() || !this.channelId) return;
    try {
      const channel = await this.client.channels.fetch(this.channelId);
      if (!channel || !channel.isTextBased()) return;

      const embed = new EmbedBuilder()
        .setColor(post.aiScore >= 9 ? 0xFF0000 : 0x00FF00)
        .setTitle(`🔥 [${(post as any).category || 'DRAMA'}] [${post.aiScore}/10] CẢM XÚC: ${post.vibe?.toUpperCase()}`)
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
    } catch (error: any) { }
  }
}