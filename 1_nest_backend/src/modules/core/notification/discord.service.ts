import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  TextChannel, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  Message, 
  Interaction 
} from 'discord.js';
import { PrismaService } from '../../../prisma/prisma.service';
import { ThreadsSeriousService } from '../../workflows/threads-serious/threads-serious.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DiscordService implements OnModuleInit {
  private readonly logger = new Logger(DiscordService.name);
  private client: Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly threadsSeriousService: ThreadsSeriousService,
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });
  }

  async onModuleInit() {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      this.logger.warn('⚠️ Không tìm thấy DISCORD_BOT_TOKEN trong biến môi trường (.env). Bot Discord sẽ tắt.');
      return;
    }

    this.client.once('clientReady', (c) => {
      this.logger.log(`🎮 Discord Bot đã online với tên: ${c.user.tag}`);
    });

    this.client.on('messageCreate', async (message: Message) => {
      if (message.author.bot) return;
      await this.handleUserMessage(message);
    });

    this.client.on('interactionCreate', async (interaction: Interaction) => {
      if (!interaction.isButton()) return;
      await this.handleButtonInteraction(interaction);
    });

    await this.client.login(token);
  }

  // =========================================================================
  // 🕵️ HÀM CỨU TRỢ: NHẬN BÀI VIẾT TỪ THỢ SĂN TỰ ĐỘNG VÀ ĐẨY LÊN KÊNH DUYỆT
  // =========================================================================
  async sendPostToReview(post: any) {
    // Ưu tiên kênh duyệt riêng, nếu không có thì đẩy vào kênh chat chính của bot
    const channelId = process.env.DISCORD_REVIEW_CHANNEL_ID || process.env.DISCORD_CHANNEL_ID;
    if (!channelId) {
      this.logger.error('❌ Không tìm thấy DISCORD_REVIEW_CHANNEL_ID hoặc DISCORD_CHANNEL_ID trong .env');
      return;
    }

    try {
      const channel = await this.client.channels.fetch(channelId) as TextChannel;
      if (!channel) {
        this.logger.error(`❌ Không tìm thấy Discord channel với ID ${channelId}`);
        return;
      }

      // Tạo thanh hành động cho phép sếp duyệt nhanh bài viết thợ săn mang về
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`run_serious_phase1_${post.id}`)
          .setLabel('🎬 CHẠY SERIOUS (PHASE 1)')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`tiktok_delete_${post.id}_none`)
          .setLabel('🗑️ BỎ QUA (XÓA)')
          .setStyle(ButtonStyle.Secondary)
      );

      await channel.send({
        content: `🕵️ **[THỢ SĂN THREADS] ĐÃ SĂN ĐƯỢC BÀI VIẾT MỚI!**\n\n` +
                 `👤 **Tác giả:** \`@${post.author}\`\n` +
                 `🔗 **Link gốc:** ${post.url}\n\n` +
                 `📝 **Nội dung thô cào được:**\n\`\`\`text\n${post.content || '(Không có nội dung)'}\n\`\`\`\n` +
                 `👇 *Sếp duyệt chế tác bài này bằng cách click nút bên dưới:*`,
        components: [row]
      });
      this.logger.log(`✅ Đã đẩy bài viết săn được của @${post.author} lên kênh duyệt Discord.`);
    } catch (err: any) {
      this.logger.error(`❌ Lỗi khi gửi tin nhắn duyệt bài của thợ săn: ${err.message}`);
    }
  }

  // =========================================================================
  // BỘ PHÂN PHỐI VÀ XỬ LÝ LỆNH GÕ TAY CỦA SẾP
  // =========================================================================
  private async handleUserMessage(message: Message) {
    const msgText = message.content.trim();
    const msgTextLower = msgText.toLowerCase();

    // LỆNH CHẠY LẠI PHASE 2 THỦ CÔNG KHI RESET SERVER
    if (msgTextLower.startsWith('!p2 ') || msgTextLower.startsWith('p2 ')) {
      const postId = msgText.replace(/^!p2\s*/i, '').replace(/^p2\s*/i, '').trim();
      const channel = message.channel as TextChannel;
      await message.reply(`🎙️ **[KÍCH HOẠT THỦ CÔNG]** Đang ép chạy lại **PHASE 2** cho ID: \`${postId}\`...`);
      await this.triggerPhase2(postId, channel);
      return;
    }

    // LỆNH CHẠY LẠI PHASE 3 RENDER THỦ CÔNG KHI SỬA XONG FE
    if (msgTextLower.startsWith('!p3 ') || msgTextLower.startsWith('p3 ')) {
      const postId = msgText.replace(/^!p3\s*/i, '').replace(/^p3\s*/i, '').trim();
      const channel = message.channel as TextChannel;
      await message.reply(`🎬 **[KÍCH HOẠT THỦ CÔNG]** Đang ép chạy lại **PHASE 3 RENDER** cho ID: \`${postId}\`...`);
      await this.triggerPhase3(postId, channel);
      return;
    }

    // LỆNH CHÍNH: !P / P - CHẠY LUỒNG WORKFLOW SERIOUS (HỖ TRỢ GÕ DÍNH LIỀN PHTTP)
    if (
      msgTextLower.startsWith('p ') || 
      msgTextLower.startsWith('!p ') || 
      msgTextLower.startsWith('p\n') ||
      msgTextLower.startsWith('phttp') ||  
      msgTextLower.startsWith('!phttp')    
    ) {
      const urlRegex = /(https?:\/\/(?:www\.)?threads\.(net|com)\/[^\s]+)/gi;
      const urls = msgText.match(urlRegex)?.map(url => url.replace(/[\]\)',"\.]+$/, '')) || [];

      if (urls.length === 0) {
        await message.reply('❌ Sếp quên dán danh sách Link Threads gốc vào rồi!');
        return;
      }
      
      let scriptContent = msgText;
      urls.forEach(u => { scriptContent = scriptContent.replace(u, ''); });
      scriptContent = scriptContent.replace(/^(?:!p|p)\s*/i, '').trim();
      
      if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        if (attachment && attachment.name.endsWith('.txt')) {
          try {
            const response = await fetch(attachment.url);
            const fileText = await response.text();
            scriptContent += '\n' + fileText; 
          } catch (err: any) {
            await message.reply(`❌ Lỗi khi đọc file đính kèm của sếp: ${err.message}`);
            return;
          }
        }
      }

      const reply = await message.reply({ 
        content: `⏳ **[PHASE 1]** Đang cào tuần tự ${urls.length} bài viết và điều phối Hugging Face (SambaNova) biên tập kịch bản nháp...`
      });
      
      try {
        const res = await this.threadsSeriousService.phase1_CreateScript(urls, undefined, scriptContent);
        
        const fullScriptText = res.chunks.map((c: any, i: number) => `${i + 1}. [${c.type.toUpperCase()}] ${c.authorName}:\n${c.text}`).join('\n\n');
        const scriptPreview = fullScriptText.substring(0, 1200);

        const tempTxtPath = path.join(process.cwd(), `kich_ban_${res.id}.txt`);
        fs.writeFileSync(tempTxtPath, fullScriptText, 'utf8');

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`serious_phase2_${res.id}`).setLabel('🎙️ TẠO ÂM THANH (PHASE 2)').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`tiktok_delete_${res.id}_none`).setLabel('🗑️ HỦY BỎ (RÁC)').setStyle(ButtonStyle.Secondary),
        );

        await reply.edit({
          content: `✅ **PHASE 1 HOÀN THÀNH!** Qwen-72B (SambaNova) đã chuẩn hóa xong kịch bản.\n\n📜 **KỊCH BẢN XEM TRƯỚC:**\n\`\`\`text\n${scriptPreview}...\n\`\`\`\n👇 *Sếp mở file đính kèm bên dưới để đọc toàn bộ kịch bản nhé!*`,
          files: [tempTxtPath],
          components: [row]
        });

        setTimeout(() => { if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath); }, 5000);

      } catch (err: any) {
        await reply.edit({ content: `❌ **LỖI TẠO KỊCH BẢN:** \`${err.message}\``, components: [] });
      }
      return; 
    }
  }

  // =========================================================================
  // BỘ NHẬN DIỆN VÀ XỬ LÝ SỰ KIỆN CLICK NÚT BẤM
  // =========================================================================
  private async handleButtonInteraction(interaction: Interaction) {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    const parts = customId.split('_'); 
    const channel = interaction.channel as TextChannel;

    // A. DUYỆT CHẠY LUỒNG SERIOUS TRỰC TIẾP TỪ BÀI SĂN TỰ ĐỘNG
    if (parts[0] === 'run' && parts[1] === 'serious' && parts[2] === 'phase1') {
      const postId = parts[3];
      await interaction.update({ content: '⏳ **[PHASE 1]** Thợ săn đã bốc bài duyệt gửi sang cụm máy chủ SambaNova xử lý...', components: [] });
      
      try {
        const post = await this.prisma.threadPost.findUnique({ where: { id: postId } });
        if (!post) throw new Error("Không tìm thấy bài viết đã săn trong DB.");

        const res = await this.threadsSeriousService.phase1_CreateScript([post.url], postId);
        
        const fullScriptText = res.chunks.map((c: any, i: number) => `${i + 1}. [${c.type.toUpperCase()}] ${c.authorName}:\n${c.text}`).join('\n\n');
        const scriptPreview = fullScriptText.substring(0, 1200);

        const tempTxtPath = path.join(process.cwd(), `kich_ban_${res.id}.txt`);
        fs.writeFileSync(tempTxtPath, fullScriptText, 'utf8');

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`serious_phase2_${res.id}`).setLabel('🎙️ TẠO ÂM THANH (PHASE 2)').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`tiktok_delete_${res.id}_none`).setLabel('🗑️ HỦY BỎ (RÁC)').setStyle(ButtonStyle.Secondary),
        );

        await channel.send({
          content: `✅ **PHASE 1 HOÀN THÀNH (BÀI SĂN)!** Qwen-72B đã chẻ xong kịch bản của sếp duyệt.\n\n📜 **KỊCH BẢN XEM TRƯỚC:**\n\`\`\`text\n${scriptPreview}...\n\`\`\`\n👇 *Sếp mở file đính kèm bên dưới để đọc toàn bộ kịch bản nhé!*`,
          files: [tempTxtPath],
          components: [row]
        });

        setTimeout(() => { if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath); }, 5000);
      } catch (err: any) {
        await channel.send({ content: `❌ **LỖI TẠO KỊCH BẢN CHO BÀI DUYỆT:** \`${err.message}\``, components: [] });
      }
      return;
    }

    // B. CLICK NÚT CHẠY PHASE 2 KOKORO TTS
    if (parts[0] === 'serious' && parts[1] === 'phase2') {
      const postId = parts[2];
      await interaction.update({ content: '🎙️ **[PHASE 2]** Đang lồng tiếng Kokoro ngầm... Tiến trình chạy cực tốc!', components: [] });
      await this.triggerPhase2(postId, channel);
      return;
    }

    // C. CLICK NÚT CHẠY PHASE 3 REMOTION RENDER
    if (parts[0] === 'serious' && parts[1] === 'phase3') {
      const postId = parts[2];
      await interaction.update({ content: '🎬 **[PHASE 3]** Đang render video bằng Remotion...', components: [] });
      await this.triggerPhase3(postId, channel);
      return;
    }

    // D. CLICK NÚT XÓA BẢN GHI RÁC TRONG DB VÀ FILE TRÊN Ổ CỨNG
    if (parts[0] === 'tiktok' && parts[1] === 'delete') {
      const postId = parts[2];
      const videoName = parts[3];
      await interaction.update({ content: '🗑️ Đang tiến hành dọn dẹp hệ thống...', components: [] });
      
      try {
        await this.prisma.threadPost.delete({ where: { id: postId } }).catch(() => {});
        if (videoName && videoName !== 'none') {
          const videoPath = path.resolve(process.cwd(), '../3_Storage_Assets/output_ready', videoName);
          if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        }
        await interaction.followUp({ content: '✅ Đã dọn sạch bản ghi và file rác khỏi hệ thống!' });
      } catch (e: any) {
        await interaction.followUp({ content: `❌ Lỗi khi dọn dẹp: ${e.message}` });
      }
      return;
    }
  }

  // =========================================================================
  // TRÌNH ĐIỀU PHỐI PHASE 2 VÀ TỰ ĐỘNG HỒI SINH NÚT BẤM KHI SẬP
  // =========================================================================
  private async triggerPhase2(postId: string, channel: TextChannel) {
    try {
      const post = await this.prisma.threadPost.findUnique({ where: { id: postId } });
      if (!post || !post.aiScriptDraft) throw new Error("Không tìm thấy kịch bản thô trong cơ sở dữ liệu.");
      
      await this.threadsSeriousService.phase2_ProcessAssets(postId, post.aiScriptDraft as any[]);
      
      const updatedPost = await this.prisma.threadPost.findUnique({ where: { id: postId } });
      const { scriptData } = updatedPost.finalScriptData as any;

      const assetInspectionList = scriptData.chunks.map((c: any, i: number) => {
        const durationSec = (c.durationInFrames / 30).toFixed(1); 
        const cardIcon = c.cardToShow === 'post' ? '📇 [BÀI GỐC]' : c.cardToShow === 'comment' ? '💬 [BÌNH LUẬN]' : '🎙️ [DẪN TRUYỆN]';
        return `== Đoạn ${i + 1} ==\n[Loại Card]: ${cardIcon}\n[Thoại]: "${c.text}"\n[Thời lượng]: ${durationSec} giây`;
      }).join('\n\n========================================\n\n');

      const totalFrames = scriptData.chunks.reduce((acc: number, c: any) => acc + c.durationInFrames, 0);
      const totalSeconds = (totalFrames / 30).toFixed(1);

      const tempReportPath = path.normalize(path.join(process.cwd(), `nghiem_thu_assets_${postId}.txt`));
      fs.writeFileSync(tempReportPath, assetInspectionList, 'utf8');

      const audioFiles: any[] = [];
      const publicDir = path.join(process.cwd(), '../2_Remotion_Video/public');

      scriptData.chunks.forEach((c: any) => {
        if (c.audioSrc) {
          const abPath = path.normalize(path.join(publicDir, c.audioSrc));
          if (fs.existsSync(abPath)) audioFiles.push({ attachment: abPath, name: path.basename(abPath) });
        }
      });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`serious_phase3_${postId}`).setLabel('🎬 XUẤT VIDEO (PHASE 3)').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`tiktok_delete_${postId}_none`).setLabel('🗑️ HỦY BỎ (XÓA RÁC)').setStyle(ButtonStyle.Secondary)
      );

      await channel.send({ 
        content: `✅ **PHASE 2 HOÀN THÀNH!**\n📊 **Tổng thời lượng video:** \`${totalSeconds} giây\`\n\n👇 *Sếp check bảng nghiệm thu text và audio lồng tiếng dưới đây.*`, 
        files: [{ attachment: tempReportPath, name: `bang_nghiem_thu_assets_${postId}.txt` }],
        components: [row] 
      });

      setTimeout(() => { if (fs.existsSync(tempReportPath)) fs.unlinkSync(tempReportPath); }, 5000);

      if (audioFiles.length > 0) {
        const safeAudioFiles = audioFiles.slice(0, 8);
        await channel.send({ content: `🔊 **DANH SÁCH GIỌNG ĐỌC AI KOKORO (NGHE THỬ):**`, files: safeAudioFiles }).catch(() => {});
      }

    } catch (err: any) {
      const retryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`serious_phase2_${postId}`).setLabel('🔄 THỬ LẠI PHASE 2').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`tiktok_delete_${postId}_none`).setLabel('🗑️ HỦY BỎ').setStyle(ButtonStyle.Secondary)
      );
      await channel.send({
        content: `❌ **PHASE 2 THẤT BẠI:** \`${err.message}\`\n👉 Sếp sửa code xong thì click nút **Thử lại** dưới đây hoặc gõ \`!p2 ${postId}\` nhé!`,
        components: [retryRow]
      }).catch(() => {});
    }
  }

  // =========================================================================
  // TRÌNH ĐIỀU PHỐI PHASE 3 VÀ TỰ ĐỘNG HỒI SINH NÚT BẤM KHI SẬP RENDER
  // =========================================================================
  private async triggerPhase3(postId: string, channel: TextChannel) {
    try {
      const res = await this.threadsSeriousService.phase3_RenderVideo(postId);
      const videoFilePath = res?.outputPath;

      if (videoFilePath && fs.existsSync(videoFilePath)) {
        const fileSizeInBytes = fs.statSync(videoFilePath).size;
        
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`tiktok_instant_${postId}`).setLabel('🚀 ĐĂNG TIKTOK NGAY!').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`tiktok_delete_${postId}_${res?.videoName}`).setLabel('🗑️ XÓA BỎ (RÁC)').setStyle(ButtonStyle.Secondary)
        );

        if (fileSizeInBytes <= 8 * 1024 * 1024) {
          await channel.send({ content: `✅ **SẢN XUẤT THÀNH CÔNG!** Video ra lò hoàn hảo.`, files: [videoFilePath], components: [row] });
        } else {
          const previewPath = await this.createDiscordPreview(videoFilePath);
          if (previewPath) {
            await channel.send({ content: `✅ **SẢN XUẤT THÀNH CÔNG!** (Gửi kèm bản nén preview)`, files: [previewPath], components: [row] });
            setTimeout(() => { if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath); }, 10000);
          } else {
            await channel.send({ content: `✅ **RENDER THÀNH CÔNG!** Video nặng, lưu sẵn tại máy: \`${res?.videoName}\``, components: [row] });
          }
        }
      }
    } catch (err: any) {
      const retryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`serious_phase3_${postId}`).setLabel('🔄 THỬ LẠI PHASE 3 (RENDER)').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`tiktok_delete_${postId}_none`).setLabel('🗑️ HỦY BỎ').setStyle(ButtonStyle.Secondary)
      );
      await channel.send({
        content: `❌ **PHASE 3 RENDER THẤT BẠI:** \`${err.message}\`\n👉 Sếp sửa file background xong thì click nút **Thử lại** dưới đây hoặc gõ \`!p3 ${postId}\` để render lại luôn!`,
        components: [retryRow]
      }).catch(() => {});
    }
  }

  private async createDiscordPreview(filePath: string): Promise<string | null> {
    return null;
  }
}