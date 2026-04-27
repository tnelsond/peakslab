# Generate Peak File

So first off, you take a tsv file that has inline HTML formatting and probably looks something like this:

```
A eɪ  អេយ៍ <ul><li><p-n>(symbol)</p-n><ol><li><p-l> @ប្រើដើម្បីដាក់ឈ្មោះផ្នែក រឺ ចំណែកទី១ នៃវត្ថុអ្វីមួយតាមធម្មដាគេសរសេរ</p-l> a)<p-l> @រឺ</p-l> <p-n>(a)</p-n></li><li><p-l>@. (ប្រើនៅប្រទេសអង់គ្លេសដោយដាក់នៅមុខលេខផ្លូវ ដើម្បីសំគាល់ថាជាផ្លូវធំ)</p-l></li><li><p-l> @(ប្រើនៅពីមុខលេខដើម្បីបង្ហាញខ្នាតក្រដាស)</p-l> an A4<p-l> @ក្រដាស</p-l> A4 4 <p-n>(abbreviation)</p-n><p-l> @អំពែ,ចំលើយ</p-l></li></ol></li></ul> symbol
a la mode ˌɑ:lɑ:ˈməʊd ˌអាឡា 'មូដ <ul><li><p-n>(adverb)</p-n><p-l> @ដោយចំណូលចិត្ត, ដោយនិយមយ៉ាងច្រើន</p-l><br/> dress ~<p-l> @តាមសម័យ (គំនិត, សំលៀកបំពាក់)</p-l></li><li><p-n>(adjective)</p-n><ol><li><p-l> @គំនិតដែលភ្ញាក់រលឹក </p-l></li><li><p-l> @នាមស្ថិតនៅជាប់ពីក្រោយ, (អាហារ) ដែលមានដាក់ការ៉េម </p-l><br/>pie ~<p-l> @មានដាក់ការ៉េមពីលើ </p-l></li></ol></li></ul> adverb
```

and you run `./peakgen file.tsv output.peak(.zst)` this will make you a peak file that can be loaded and searched by PeakSlab. PeakSlab will remove all the HTML tags and capital letters and zero-width-spaces and put references to them in the tag section of the peak file. This way the text can be searched without all the markup getting in the way.

## Markers and Tabs

Note that peakslab is not really column based. You can't search by columns specifically, it's just syntactic stuff. But PeakSlab considers a tab to be like the end of a string of text, so if you put the **@** index marker and then some text and then a tab, that text will be considered a synonym for that entry. It doesn't need to end in a tab, and entries do not need to have the same number of tabs at all.

You can even nest index markers, e.g. `@Jesus @Christ`.
This makes it so that `Jesus Christ` and `Christ` are both synonyms for whatever entry that is, but not `Jesus` since there's no tab or null delimeter after `@Jesus`.

PeakSlab automatically considers the text up to the first tab to be the headword of that entry. But an entry doesn't need to have a tab at all, but in that case the full text of that line will be the headword.

### Secondary Marker

Just as **@** is the primary marker for synonyms and such, **^** is the secondary marker. Secondary markers are indexed, but they're not considered to be authorative synonyms only to be words that appear in the headword that may be of immediate interest. You could put things like `^adjective` or categories for this, but there's no hard rules. I haven't actually tried using them yet other than in initial creation. Full brute search with Stringzilla is so fast that these might not be necessary at all.

# PeakSlab markup

I don't really like putting `<div class="ipa">` everywhere, especially since it becomes really hard to know which thing the closing `</div>` tag belongs to, so I made my own custom elements. (You don't have to use them, but I think they're nice.)

- `<p-a>other word</p-a>` This tag makes a clickable link that opens a popup-modal with the definition of **other word**.
- `<p-l>សុខសប្បាយ</p-l>` this is a **language** tag to differentiate languages when they're packed together so you can have a sentence and its translation flow together but still be distinct.
- `<p-n>Notes</p-n>` This is great for putting notes or position and other stuff that doesn't need to be as prominent.
- `<p-ipa>ɑ:lɑ:ˈməʊd</p-ipa>` for putting pronounciation in.
