import json
import urllib.parse

import discord
from discord import app_commands
from discord.ext import commands

import config
import database as db


def _decode_best_effort(raw: bytes) -> str:
    """UTF-8을 우선 시도하고, 실패하면 한글 환경에서 흔한 인코딩(cp949 등)을 순서대로 시도한다.
    메모장으로 열어서 저장하다가 인코딩이 깨진 파일도 최대한 살려서 읽기 위함."""
    for encoding in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    # 전부 실패하면 원래 에러(utf-8 기준)를 그대로 발생시킨다.
    raw.decode("utf-8")
    return ""  # 위 줄에서 항상 예외가 발생하므로 도달하지 않음


def is_server_owner():
    """서버(길드)의 소유자만 명령어를 쓸 수 있도록 하는 체크."""

    async def predicate(interaction: discord.Interaction) -> bool:
        if interaction.guild is None:
            raise app_commands.CheckFailure("이 명령어는 서버 안에서만 사용할 수 있어요.")
        if interaction.user.id != interaction.guild.owner_id:
            raise app_commands.CheckFailure("이 명령어는 디스코드 서버(방)의 주인만 사용할 수 있어요.")
        return True

    return app_commands.check(predicate)


class SongCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    song_group = app_commands.Group(name="song", description="리듬게임 노래(채보) 관리")

    # ---------- 조회 계열 (누구나 사용 가능) ----------

    @song_group.command(name="list", description="등록된 노래 목록을 보여줘요.")
    async def song_list(self, interaction: discord.Interaction):
        songs = await db.list_songs()
        if not songs:
            await interaction.response.send_message("아직 등록된 노래가 없어요. 서버 주인이 `/song add` 로 추가할 수 있어요.")
            return

        lines = []
        for song_id, song in songs.items():
            note_count = len(song.get("notes", []))
            lines.append(f"• **{song['title']}** (`{song_id}`) - {song.get('artist','?')} | 난이도: {song.get('difficulty','?')} | 노트 {note_count}개")
        await interaction.response.send_message("🎵 **등록된 노래 목록**\n" + "\n".join(lines))

    @song_group.command(name="info", description="특정 노래의 상세 정보를 보여줘요.")
    @app_commands.describe(id="노래 id (/song list 에서 확인)")
    async def song_info(self, interaction: discord.Interaction, id: str):
        song = await db.get_song(id)
        if song is None:
            await interaction.response.send_message(f"`{id}` 노래를 찾을 수 없어요.", ephemeral=True)
            return
        embed = discord.Embed(title=song["title"], description=f"아티스트: {song.get('artist','?')}")
        embed.add_field(name="BPM", value=str(song.get("bpm", "?")))
        embed.add_field(name="난이도", value=song.get("difficulty", "?"))
        embed.add_field(name="노트 수", value=str(len(song.get("notes", []))))
        embed.set_footer(text=f"id: {id}")
        await interaction.response.send_message(embed=embed)

    # ---------- 관리 계열 (서버 주인 전용) ----------

    @song_group.command(name="add", description="[서버 주인 전용] 새 노래(채보)를 추가해요. JSON 채보 파일을 첨부하세요.")
    @app_commands.describe(
        id="노래를 구분할 고유 id (영문/숫자, 공백 없이)",
        chart_file="채보 JSON 파일 (charts/example_song.json 형식 참고)",
    )
    @is_server_owner()
    async def song_add(self, interaction: discord.Interaction, id: str, chart_file: discord.Attachment):
        await interaction.response.defer(thinking=True)

        if chart_file.size > config.MAX_CHART_SIZE:
            await interaction.followup.send("채보 파일이 너무 커요 (512KB 이하로 올려주세요).")
            return

        try:
            raw = await chart_file.read()
            chart = json.loads(_decode_best_effort(raw))
            db.validate_chart(chart)
        except UnicodeDecodeError:
            await interaction.followup.send(
                "파일 인코딩을 읽을 수 없어요. 메모장으로 열어서 수정하셨다면, "
                "다른 이름으로 저장할 때 인코딩을 **UTF-8**로 지정해서 다시 올려주세요."
            )
            return
        except json.JSONDecodeError:
            await interaction.followup.send("파일이 올바른 JSON 형식이 아니에요.")
            return
        except db.ChartValidationError as e:
            await interaction.followup.send(f"채보 형식 오류: {e}")
            return

        try:
            await db.add_song(id, chart, created_by=interaction.user.id)
        except db.ChartValidationError as e:
            await interaction.followup.send(str(e))
            return

        await interaction.followup.send(f"✅ **{chart.get('title', id)}** 노래를 추가했어요! (`id: {id}`)")

    @song_group.command(name="edit", description="[서버 주인 전용] 기존 노래 정보를 수정해요.")
    @app_commands.describe(
        id="수정할 노래의 id",
        title="새 제목 (선택)",
        artist="새 아티스트 (선택)",
        bpm="새 BPM (선택)",
        difficulty="새 난이도 (선택)",
        audio_url="재생할 오디오 URL (선택)",
        chart_file="새 채보 JSON 파일로 통째로 교체 (선택)",
    )
    @is_server_owner()
    async def song_edit(
        self,
        interaction: discord.Interaction,
        id: str,
        title: str = None,
        artist: str = None,
        bpm: int = None,
        difficulty: str = None,
        audio_url: str = None,
        chart_file: discord.Attachment = None,
    ):
        await interaction.response.defer(thinking=True)

        existing = await db.get_song(id)
        if existing is None:
            await interaction.followup.send(f"`{id}` 노래를 찾을 수 없어요.")
            return

        updates = {}
        if title is not None:
            updates["title"] = title
        if artist is not None:
            updates["artist"] = artist
        if bpm is not None:
            updates["bpm"] = bpm
        if difficulty is not None:
            updates["difficulty"] = difficulty
        if audio_url is not None:
            updates["audio_url"] = audio_url

        if chart_file is not None:
            try:
                raw = await chart_file.read()
                chart = json.loads(_decode_best_effort(raw))
                db.validate_chart(chart)
                updates["notes"] = chart["notes"]
            except UnicodeDecodeError:
                await interaction.followup.send(
                    "파일 인코딩을 읽을 수 없어요. 메모장으로 열어서 수정하셨다면, "
                    "다른 이름으로 저장할 때 인코딩을 **UTF-8**로 지정해서 다시 올려주세요."
                )
                return
            except json.JSONDecodeError:
                await interaction.followup.send("첨부한 파일이 올바른 JSON 형식이 아니에요.")
                return
            except db.ChartValidationError as e:
                await interaction.followup.send(f"채보 형식 오류: {e}")
                return

        if not updates:
            await interaction.followup.send("수정할 항목을 하나 이상 입력해주세요.")
            return

        await db.update_song(id, updates)
        await interaction.followup.send(f"✅ `{id}` 노래 정보를 수정했어요.")

    @song_group.command(name="remove", description="[서버 주인 전용] 노래를 삭제해요.")
    @app_commands.describe(id="삭제할 노래의 id")
    @is_server_owner()
    async def song_remove(self, interaction: discord.Interaction, id: str):
        deleted = await db.delete_song(id)
        if deleted:
            await interaction.response.send_message(f"🗑️ `{id}` 노래를 삭제했어요.")
        else:
            await interaction.response.send_message(f"`{id}` 노래를 찾을 수 없어요.", ephemeral=True)

    # ---------- 에러 처리 ----------

    @song_add.error
    @song_edit.error
    @song_remove.error
    async def on_owner_check_error(self, interaction: discord.Interaction, error: app_commands.AppCommandError):
        if isinstance(error, app_commands.CheckFailure):
            msg = str(error) or "이 명령어는 서버 주인만 사용할 수 있어요."
            if interaction.response.is_done():
                await interaction.followup.send(msg, ephemeral=True)
            else:
                await interaction.response.send_message(msg, ephemeral=True)
        else:
            raise error


class PlayCog(commands.Cog):
    """웹사이트(리듬게임) 링크를 보내주는 명령어. 음성채널/Activity가 필요 없어요."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="play", description="리듬게임 웹사이트 링크를 보내줘요.")
    @app_commands.describe(id="플레이할 노래의 id (/song list 로 확인, 비워두면 곡 목록 페이지로)")
    async def play(self, interaction: discord.Interaction, id: str = None):
        if not config.SITE_URL:
            await interaction.response.send_message(
                "봇 설정에 SITE_URL이 없어서 링크를 만들 수 없어요. (.env 의 SITE_URL 확인)", ephemeral=True
            )
            return

        base = config.SITE_URL.rstrip("/")

        if id is None:
            url = f"{base}/"
            label = "🎮 리듬게임 하러가기"
        else:
            song = await db.get_song(id)
            if song is None:
                await interaction.response.send_message(f"`{id}` 노래를 찾을 수 없어요.", ephemeral=True)
                return
            url = f"{base}/?song={urllib.parse.quote(id)}"
            label = f"🎮 {song['title']} 플레이하기"

        view = discord.ui.View()
        view.add_item(discord.ui.Button(label=label, url=url, style=discord.ButtonStyle.link))
        try:
            await interaction.response.send_message("아래 버튼을 눌러 브라우저에서 바로 플레이하세요!", view=view)
        except discord.HTTPException:
            await interaction.response.send_message(
                f"버튼 생성에 실패했어요. 만들어진 주소가 이상해요: `{url}`\n"
                f"(bot/.env 의 SITE_URL 값을 확인해주세요. 예: http://127.0.0.1:8787)"
            )


async def setup(bot: commands.Bot):
    await bot.add_cog(SongCog(bot))
    await bot.add_cog(PlayCog(bot))
