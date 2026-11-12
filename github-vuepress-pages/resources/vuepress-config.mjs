import { viteBundler } from '@vuepress/bundler-vite'
import { defaultTheme } from '@vuepress/theme-default'
import { defineUserConfig } from 'vuepress'

export default defineUserConfig({
  // For project sites (https://<owner>.github.io/<repo>/), base MUST be '/<repo>/'.
  // For user/org sites (https://<owner>.github.io/), set base to '/'.
  base: '/<REPO_NAME>/',

  lang: 'zh-CN',
  title: '<PROJECT_TITLE>',
  description: '<PROJECT_DESCRIPTION>',

  bundler: viteBundler(),

  theme: defaultTheme({
    repo: '<OWNER>/<REPO_NAME>',
    docsDir: 'docs',
    navbar: [
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '指南',
          children: [
            '/guide/README.md',
          ],
        },
      ],
    },
  }),
})
