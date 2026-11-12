import { viteBundler } from '@vuepress/bundler-vite'
import { defaultTheme } from '@vuepress/theme-default'
import { defineUserConfig } from 'vuepress'

export default defineUserConfig({
  base: '/skills/',

  lang: 'zh-CN',
  title: 'Skills',
  description: '日常使用的 Skill 合集：标准化收纳、本地 Web 管理台与自动化文档发布',

  bundler: viteBundler(),

  theme: defaultTheme({
    repo: 'chansanya/skills',
    docsDir: 'docs',
    navbar: [
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/' },
      { text: 'Skill 规范', link: '/guide/skill-spec.md' },
      { text: 'Web 管理台', link: '/guide/web.md' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '指南',
          children: [
            '/guide/README.md',
            '/guide/skill-spec.md',
            '/guide/web.md',
            '/guide/deploy.md',
          ],
        },
      ],
    },
  }),
})
