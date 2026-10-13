FROM mcr.microsoft.com/devcontainers/python:1-3.12-bookworm

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-noto-cjk openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/*
USER vscode
