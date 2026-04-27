# Add a language

So you want to add a language, or use peakslab in your own project? Great.
There's a little script that'll help you along the way.

```
./setupnewlang.sh NEWNAME LANG_CODE APPNAME
```

This will make a new folder that is a derived from the Chitonga folder with everything changed to be for the new language. Make sure to edit `config.js` to update the dictionary list. Also add any new files to `sw.js` so they get tracked and cached properly by the service worker.
