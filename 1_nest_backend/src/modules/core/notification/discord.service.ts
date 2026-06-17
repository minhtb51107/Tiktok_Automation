import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, TextChannel } from 'discord.js';
import { PrismaService } from '../../../prisma/prisma.service';

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
  
  private activeJobs = new Map<string, AbortController>();

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

      const msgTextLower = message.content.trim().toLowerCase();
      const msgText = message.content.trim();

      if (msgTextLower.startsWith('!mix') || msgTextLower.startsWith('mix!')) {
        const urls = msgText.replace(/^!mix\s*/i, '').replace(/^mix!\s*/i, '').split(/[\s\n]+/).filter(url => url.includes('threads.net') || url.includes('threads.com'));
        
        if (urls.length === 0) {
            await message.reply('❌ Sếp chưa đưa link Threads nào hợp lệ cả!');
            return;
        }

        const jobId = `mix_${Date.now()}`;
        const abortController = new AbortController();
        this.activeJobs.set(jobId, abortController);

        const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`cancel_${jobId}`).setLabel('🛑 DỪNG KHẨN CẤP').setStyle(ButtonStyle.Danger)
        );

        const reply = await message.reply({ 
            content: `⏳ **Đã nhận lệnh MIX!** Đang gộp ${urls.length} bài viết thành 1 video...`,
            components: [cancelRow]
        });
        
        try {
            const res = await this.threadsCompilationService.processCompilationVideo(urls, async (status) => {
                await reply.edit({ content: status, components: [cancelRow] }).catch(() => {});
            }, abortController.signal);
            
            const videoFilePath = res?.outputPath;

            if (videoFilePath && fs.existsSync(videoFilePath)) {
                 const fileSizeInBytes = fs.statSync(videoFilePath).size;
                 const fileSizeInMB = fileSizeInBytes / (1024 * 1024);

                 if (fileSizeInBytes <= 8 * 1024 * 1024) {
                    await reply.edit({ content: '🚀 **BẮT ĐẦU XUẤT XƯỞNG!** Đang upload video lên Discord...', components: [] });
                    await reply.edit({
                       content: `✅ **MIX THÀNH CÔNG!**\n🎥 Tên file: \`${res?.videoName}\` (Nặng ${fileSizeInMB.toFixed(1)}MB)\n✍️ Caption: \`${res?.caption}\``,
                       files: [videoFilePath]
                    });
                 } else {
                     await reply.edit({ content: `🔄 **Video đang xuất... (Đang nén thêm bản Preview cho Discord vì file gốc nặng tới ${fileSizeInMB.toFixed(1)}MB)**`, components: [] });
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
                 await reply.edit({ content: `✅ **MIX THÀNH CÔNG!** Nhưng không tìm thấy file vật lý.`, components: [] });
            }
        } catch (err: any) {
            if (err.message === 'ABORTED' || err.name === 'AbortError') {
                await reply.edit({ content: `🛑 **ĐÃ HỦY TIẾN TRÌNH MIX!** Hệ thống đã an toàn.`, components: [] });
            } else {
                await reply.edit({ content: `❌ **LỖI TỔNG HỢP:** \`${err.message}\``, components: [] });
            }
        } finally {
            this.activeJobs.delete(jobId);
        }
        return; 
      }

      if (msgTextLower.startsWith('p ') || msgTextLower.startsWith('!p ') || msgTextLower.startsWith('p\n')) {
        const urlMatch = msgText.match(/(https?:\/\/(?:www\.)?threads\.(net|com)\/[^\s]+)/i);
        if (!urlMatch) {
            await message.reply('❌ Sếp quên dán Link Threads gốc vào rồi! Phải có link thì bot mới đi cào Avatar thật và Ảnh thật được!');
            return;
        }
        
        const primaryUrl = urlMatch[0].replace(/[\]\)',"\.]+$/, '');
        let scriptContent = msgText.replace(urlMatch[0], '').replace(/^(?:!p|p)\s*/i, '').trim();
        
        if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            if (attachment && attachment.name.endsWith('.txt')) {
                try {
                    const response = await fetch(attachment.url);
                    const fileText = await response.text();
                    scriptContent += '\n' + fileText; // Gộp nội dung file vào kịch bản
                } catch (err: any) {
                    await message.reply(`❌ Lỗi khi đọc file đính kèm của sếp: ${err.message}`);
                    return;
                }
            }
        }

        if (!scriptContent.includes('<CHUNK')) {
            await message.reply('❌ Kịch bản thiếu thẻ `<CHUNK>`! (Sếp dán trực tiếp hoặc đính kèm file .txt chứa kịch bản nhé).');
            return;
        }

        const jobId = `podcast_${Date.now()}`;
        const abortController = new AbortController();
        this.activeJobs.set(jobId, abortController);

        const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`cancel_${jobId}`).setLabel('🛑 DỪNG KHẨN CẤP').setStyle(ButtonStyle.Danger)
        );

        const reply = await message.reply({ 
            content: `⏳ **Đã nhận Lệnh!** Đang đi cào dữ liệu gốc từ Link và khớp với Kịch bản (đã gộp file)...`,
            components: [cancelRow]
        });
        
        try {
            const res = await this.threadsSeriousService.processSeriousVideo(primaryUrl, scriptContent, async (status) => {
                await reply.edit({ content: status, components: [cancelRow] }).catch(() => {});
            }, abortController.signal);
            
            const videoFilePath = res?.outputPath;
            if (videoFilePath && fs.existsSync(videoFilePath)) {
                 const fileSizeInBytes = fs.statSync(videoFilePath).size;
                 const fileSizeInMB = fileSizeInBytes / (1024 * 1024);

                 const uniqueId = `manual_podcast_${Date.now()}`;
                 const scriptData = res?.script as any;

                 const savedPost = await this.prisma.threadPost.create({
                    data: {
                       threadId: uniqueId,
                       author: scriptData?.postInfo?.author || 'Anonymous',
                       avatarUrl: scriptData?.postInfo?.avatar || null,
                       content: scriptData?.postInfo?.text || 'Video Podcast từ kịch bản',
                       url: primaryUrl, 
                       category: 'SERIOUS', 
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
                    await reply.edit({ content: '🚀 **BẮT ĐẦU XUẤT XƯỞNG!** Đang upload video lên Discord...', components: [] });
                    await reply.edit({
                       content: `✅ **SẢN XUẤT THÀNH CÔNG!**\n🎥 Tên file: \`${res?.videoName}\` (Nặng ${fileSizeInMB.toFixed(1)}MB)\n\nSếp kiểm tra thành phẩm và Đăng ngay nhé!`,
                       files: [videoFilePath],
                       components: [row]
                    });
                 } else {
                     await reply.edit({ content: `🔄 **Video đang xuất... (Đang nén thêm bản Preview cho Discord vì file gốc nặng tới ${fileSizeInMB.toFixed(1)}MB)**`, components: [] });
                     const previewPath = await this.createDiscordPreview(videoFilePath);
                     if (previewPath) {
                        await reply.edit({
                            content: `✅ **SẢN XUẤT THÀNH CÔNG!** (Bản Preview xem trước)\n📂 Bản gốc lưu tại máy tính.\n`,
                            files: [previewPath],
                            components: [row]
                        });
                        setTimeout(() => { if(fs.existsSync(previewPath)) fs.unlinkSync(previewPath); }, 10000);
                    } else {
                        await reply.edit({ content: `✅ **SẢN XUẤT THÀNH CÔNG!** Video quá nặng: \`${res?.videoName}\``, components: [row] });
                    }
                 }
            }
        } catch (err: any) {
            if (err.message === 'ABORTED' || err.name === 'AbortError') {
                await reply.edit({ content: `🛑 **ĐÃ HỦY TIẾN TRÌNH SẢN XUẤT!** Hệ thống đã an toàn.`, components: [] });
            } else {
                await reply.edit({ content: `❌ **LỖI:** \`${err.message}\``, components: [] });
            }
        } finally {
            this.activeJobs.delete(jobId);
        }
        return; 
      }

      const urlRegex = /(https?:\/\/(?:www\.)?threads\.(net|com)\/[^\s]+)/gi;
      const matches = message.content.match(urlRegex);

      if (matches) {
        if (matches.length > 1) {
            await message.reply('❌ **BÁO ĐỘNG:** Sếp dán nhiều link mà quên ghi chữ `!mix` ở đầu kìa!');
            return;
        }

        const primaryUrl = matches[0].replace(/[\]\)',"\.]+$/, '');
        const jobId = `drama_${Date.now()}`;
        const abortController = new AbortController();
        this.activeJobs.set(jobId, abortController);

        const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`cancel_${jobId}`).setLabel('🛑 DỪNG KHẨN CẤP').setStyle(ButtonStyle.Danger)
        );

        const reply = await message.reply({ 
            content: `⏳ **Đã tiếp nhận lệnh!** Đang đưa bài viết vào xưởng chế tác DRAMA...`,
            components: [cancelRow]
        });
        
        try {
          const res = await this.threadsDramaService.processDramaVideo(primaryUrl, async (status) => { 
             await reply.edit({ content: status, components: [cancelRow] }).catch(() => {}); 
          }, abortController.signal);
            
          const videoFilePath = res?.outputPath; 

          if (videoFilePath && fs.existsSync(videoFilePath)) {
             const fileSizeInBytes = fs.statSync(videoFilePath).size;
             const fileSizeInMB = fileSizeInBytes / (1024 * 1024);

             const cleanUrl = primaryUrl.split('?')[0];
             const uniqueId = `manual_${Date.now()}`;
             const scriptData = res?.script as any;

             const savedPost = await this.prisma.threadPost.create({
                data: {
                   threadId: uniqueId,
                   author: scriptData?.postInfo?.author || scriptData?.post?.author || 'Anonymous',
                   avatarUrl: scriptData?.postInfo?.avatar || scriptData?.post?.avatar || null,
                   content: scriptData?.post?.text || 'Video từ Link thủ công',
                   url: cleanUrl,
                   category: 'DRAMA', 
                   caption: res?.caption || 'Video drama #xuhuong #threads',
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
                await reply.edit({ content: '🚀 **BẮT ĐẦU XUẤT XƯỞNG!** Đang upload video lên Discord...', components: [] });
                await reply.edit({
                   content: `✅ **XUẤT XƯỞNG VIDEO THÀNH CÔNG!**\n🎥 Tên file: \`${res?.videoName}\` (Nặng ${fileSizeInMB.toFixed(1)}MB)\n✍️ Caption AI: \`${res?.caption}\`\n\nSếp kiểm tra thành phẩm.`,
                   files: [videoFilePath],
                   components: [row]
                });
             } else {
                 await reply.edit({ content: `🔄 **Video đang xuất... (Đang nén thêm bản Preview cho Discord vì file gốc nặng tới ${fileSizeInMB.toFixed(1)}MB)**`, components: [] });
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
             await reply.edit({ content: `✅ **RENDER THÀNH CÔNG!** Nhưng không tìm thấy file vật lý.`, components: [] });
          }
        } catch (err: any) {
          if (err.message === 'ABORTED' || err.name === 'AbortError') {
              await reply.edit({ content: `🛑 **ĐÃ HỦY TIẾN TRÌNH DRAMA!** Máy chủ đã an toàn theo lệnh của sếp!`, components: [] });
          } else {
              await reply.edit({ content: `❌ **TIẾN TRÌNH THẤT BẠI!**\n🚨 **Lỗi:** \`${err.message}\``, components: [] });
          }
        } finally {
          this.activeJobs.delete(jobId);
        }
      }
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton()) return;
      const parts = interaction.customId.split('_');

      if (parts[0] === 'cancel') {
        const jobId = parts.slice(1).join('_'); 
        const controller = this.activeJobs.get(jobId);
        
        if (controller) {
            await interaction.update({ content: '🛑 **Đang ra lệnh bóp cổ tiến trình...** Vui lòng đợi hệ thống dọn rác!', components: [] });
            controller.abort(); 
            this.activeJobs.delete(jobId);
        } else {
            await interaction.update({ content: '❌ Tiến trình này đã kết thúc từ trước hoặc không tồn tại.', components: [] });
        }
        return;
      }

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
              await interaction.editReply('✅ **ĐÃ XÓA SẠCH SẼ!** Giải phóng dung lượng ổ cứng thành công.');
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
          const jobId = `approve_${postId}`;
          const abortController = new AbortController();
          this.activeJobs.set(jobId, abortController);

          const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder().setCustomId(`cancel_${jobId}`).setLabel('🛑 DỪNG KHẨN CẤP').setStyle(ButtonStyle.Danger)
          );

          await interaction.update({ components: [] }); 
          const isSerious = (post as any).category === 'SERIOUS';
          const msg = await interaction.followUp({ 
              content: `🎬 **ĐÃ DUYỆT!** Đang xả khói Render video [${isSerious ? 'PODCAST' : 'DRAMA'}] cho bài của \`${post.author}\`...`,
              components: [cancelRow]
          });
          
          await this.prisma.threadPost.update({ where: { id: postId }, data: { isApproved: true } });
          
          const renderTask = isSerious 
            ? this.threadsSeriousService.processSeriousVideo(
                post.url, 
                `<CHUNK type="post" author="${post.author}">\n${post.content}\n</CHUNK>\n<CHUNK type="analysis" keyword="thinking">\nĐó là một góc nhìn rất thú vị và thực tế.\n</CHUNK>`, 
                async (status) => { await msg.edit({ content: status, components: [cancelRow] }).catch(() => {}); }, 
                abortController.signal
              )
            : this.threadsDramaService.processDramaVideo(
                post.url, 
                async (status) => { await msg.edit({ content: status, components: [cancelRow] }).catch(() => {}); }, 
                abortController.signal
              );

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
                    await msg.edit({ content: `🔄 **Video đang xuất... (Đang nén thêm bản Preview cho Discord)**`, components: [] });
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
          }).catch(async (err) => { 
             if (err.message === 'ABORTED' || err.name === 'AbortError') {
                 await msg.edit({ content: `🛑 **ĐÃ HỦY DUYỆT BÀI!** Tiến trình đã dừng.`, components: [] });
             } else {
                 await msg.edit({ content: `❌ **RENDER THẤT BẠI:** ${err.message}`, components: [] }); 
             }
          }).finally(() => {
             this.activeJobs.delete(jobId);
          });

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

      await (channel as TextChannel).send({ embeds: [embed], components: [row] });
    } catch (error: any) { }
  }
}
