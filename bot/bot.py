import asyncio
import logging

import discord
from discord.ext import commands

import config

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("discobeat")

intents = discord.Intents.default()


class DiscoBeatBot(commands.Bot):
    def __init__(self):
        super().__init__(command_prefix="!disco-unused!", intents=intents)

    async def setup_hook(self):
        await self.load_extension("cogs.songs")
        synced = await self.tree.sync()
        log.info(f"슬래시 커맨드 {len(synced)}개 동기화 완료")


bot = DiscoBeatBot()


@bot.event
async def on_ready():
    log.info(f"로그인 완료: {bot.user} (id: {bot.user.id})")


def main():
    if not config.DISCORD_TOKEN:
        raise RuntimeError("DISCORD_TOKEN 이 설정되지 않았어요. .env 파일을 확인하세요.")
    bot.run(config.DISCORD_TOKEN)


if __name__ == "__main__":
    main()
