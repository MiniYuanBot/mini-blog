/** Personal information is drawn from the old project's profile configuration.
 * Add research interests and external profiles only when ready to publish them.
 */
export const site = {
  name: 'miniblog',
  title: 'miniblog: miniyuan is getting stronger!',
  description: 'The personal website of miniyuan: research, projects, explorations, and study notes.',
  url: 'https://miniyuan.site',
  language: 'en',
  affiliation: 'Peking University',
  department: 'College of Engineering',
  introduction: 'I study engineering scientific computing at Peking University, alongside a second major in computer science and technology.',
  researchInterests: ['Network', 'MLSys'] as string[],
  links: [] as { label: string; url: string }[],
  contact: {
    github: 'https://github.com/MiniYuanBot',
    issues: 'https://github.com/MiniYuanBot/mini-blog/issues',
    phone: '+8618813123558',
    phoneLabel: '+86 188 1312 3558',
    email: 'miniyuan@stu.pku.edu.cn',
  },
  pageSize: 10,
};

// Add reviewed blogs in the order you want them to appear on the Friends page.
export const friends: {
  name: string;
  url: string;
  recommendation: string;
}[] = [
    {
      name: 'luoluo',
      url: 'https://luoluo926.github.io/',
      recommendation: 'A forever stupid girl.'
    },
    {
      name: 'Kristina',
      url: 'https://itskristina.space/',
      recommendation: 'I solemnly swear I am up to no good.'
    }
  ];

export const sections = {
  publications: { title: 'Publications', description: 'Research directions and published work.', singular: 'publication', empty: 'No publications listed yet.' },
  projects: { title: 'Projects', description: 'Software, experiments, and things I build.', singular: 'project', empty: 'No projects listed yet.' },
  explorations: { title: 'Explorations', description: 'Reading papers, tracing source code, and thinking through ideas.', singular: 'exploration', empty: 'No explorations published yet.' },
  studies: { title: 'Studies', description: 'Notes from courses and independent study.', singular: 'study note', empty: 'No study notes published yet.' },
} as const;

export const collectionNames = ['publications', 'projects', 'explorations', 'studies'] as const;
export type CollectionName = typeof collectionNames[number];
