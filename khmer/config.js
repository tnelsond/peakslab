// config.js
export const dictionaryGroups = [
    { groupName: 'All', index: 0, subDicts: [] },
    {
        groupName: 'Dictionaries',
        subDicts: [
            { filename: 'db/sonv.peak.zst', displayName: 'En>Km', index: 1, templates: ['<h1>###</h1>', '<p-des>###</li></ul></p-des>'] },
            { filename: 'db/kh.peak.zst', displayName: 'Km>En', index: 2 },
            { filename: 'db/nath2022.peak.zst', displayName: 'Km>Km', index: 3 },
            { filename: 'db/ant.peak.zst', displayName: 'ANT', index: 4 },
            { filename: 'db/baby.peak.zst', displayName: 'Baby', index: 5 },
            { filename: 'db/sea_count.peak.zst', displayName: 'SeaC', index: 6 },
        ]
    },
    {
        groupName: 'Bible',
        subDicts: [
            { filename: 'db/km_ulb.peak.zst', displayName: 'Bible', index: 7 },
            { filename: 'db/strongs.peak.zst', displayName: 'Strongs', index: 8 },
            { filename: 'db/bible.peak.zst', displayName: 'bible', index: 9 },
            { filename: 'db/bibletrans.peak.zst', displayName: 'bibletran', index: 10 },
        ]
    },
    {
        groupName: 'Other',
        subDicts: [
            { filename: 'db/hymns.peak.zst', displayName: 'Hymns', index: 11 },
        ]
    }
];
