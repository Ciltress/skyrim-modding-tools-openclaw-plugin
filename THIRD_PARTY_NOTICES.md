# Third-party notices

The plugin is licensed under the GNU General Public License v3.0 only (`LICENSE`). A package installed from ClawHub
bundles [skyrim-modding-tools-core](https://github.com/Ciltress/skyrim-modding-tools-core) (GPL-3.0-only) in
`node_modules/skyrim-modding-tools-core`, together with its plugin helper, built: `helper/bin`. The source of
everything in the package is the plugin repository at the release's commit, and the core repository at the tag
named by `version` in `node_modules/skyrim-modding-tools-core/package.json`. The helper's project is
`helper/SkyrimHelper` in the core repository.

The helper runs on the .NET 10 runtime, which is not bundled. Its launchers, `SkyrimHelper.exe` and `SkyrimHelper`,
are .NET's application host (MIT, [dotnet/runtime](https://github.com/dotnet/runtime)). It ships these libraries
from NuGet, each under its own license; the source of each is its project at the version named.

| Package | Version | License | Source |
|---|---|---|---|
| DynamicData | 9.4.31 | MIT | https://github.com/reactiveui/DynamicData |
| FluentResults | 3.15.2 | MIT | https://github.com/altmann/FluentResults |
| GameFinder.Common | 4.9.0 | GPL-3.0-only | https://github.com/erri120/GameFinder |
| GameFinder.RegistryUtils | 4.9.0 | GPL-3.0-only | https://github.com/erri120/GameFinder |
| GameFinder.StoreHandlers.GOG | 4.9.0 | GPL-3.0-only | https://github.com/erri120/GameFinder |
| GameFinder.StoreHandlers.Steam | 4.9.0 | GPL-3.0-only | https://github.com/erri120/GameFinder |
| GameFinder.StoreHandlers.Xbox | 4.9.0 | GPL-3.0-only | https://github.com/erri120/GameFinder |
| GameFinder.Wine | 4.9.0 | GPL-3.0-only | https://github.com/erri120/GameFinder |
| ini-parser-netstandard | 2.5.3 | MIT | https://github.com/rickyah/ini-parser |
| K4os.Compression.LZ4 | 1.3.8 | MIT | https://github.com/MiloszKrajewski/K4os.Compression.LZ4 |
| K4os.Compression.LZ4.Streams | 1.3.8 | MIT | https://github.com/MiloszKrajewski/K4os.Compression.LZ4 |
| K4os.Hash.xxHash | 1.0.8 | MIT | https://github.com/MiloszKrajewski/K4os.Hash.xxHash |
| Loqui | 3.7.0 | GPL-3.0 | https://github.com/Noggog/Loqui |
| Microsoft.Extensions.DependencyInjection.Abstractions | 9.0.4 | MIT | https://github.com/dotnet/runtime |
| Microsoft.Extensions.Logging.Abstractions | 9.0.4 | MIT | https://github.com/dotnet/runtime |
| Mutagen.Bethesda.Core | 0.54.0 | GPL-3.0-only | https://github.com/Mutagen-Modding/Mutagen |
| Mutagen.Bethesda.Kernel | 0.54.0 | GPL-3.0-only | https://github.com/Mutagen-Modding/Mutagen |
| Mutagen.Bethesda.Serialization | 1.38.6 | GPL-3.0-only | https://github.com/Mutagen-Modding/Mutagen.Bethesda.Serialization |
| Mutagen.Bethesda.Serialization.Yaml | 1.38.6 | GPL-3.0-only | https://github.com/Mutagen-Modding/Mutagen.Bethesda.Serialization |
| Mutagen.Bethesda.Skyrim | 0.54.0 | GPL-3.0-only | https://github.com/Mutagen-Modding/Mutagen |
| NexusMods.Paths | 0.19.1 | GPL-3.0-only | https://github.com/Nexus-Mods/NexusMods.App |
| Noggog.CSharpExt | 4.3.0 | GPL-3.0 | https://github.com/Noggog/CSharpExt |
| OneOf | 3.0.271 | MIT | https://github.com/mcintyre321/OneOf |
| Reloaded.Memory | 9.4.2 | GPL-3.0, parts MIT (marked in its source) | https://github.com/Reloaded-Project/Reloaded.Memory |
| SharpCompress | 0.50.4 | MIT | https://github.com/adamhathcock/sharpcompress |
| SharpZipLib | 1.4.2 | MIT | https://github.com/icsharpcode/SharpZipLib |
| StrongInject | 1.4.4 | MIT | https://github.com/YairHalberstadt/stronginject |
| System.Data.HashFunction.Core | 2.0.0 | MIT | https://github.com/brandondahler/Data.HashFunction |
| System.Data.HashFunction.Interfaces | 2.0.0 | MIT | https://github.com/brandondahler/Data.HashFunction |
| System.Data.HashFunction.xxHash | 2.0.0 | MIT | https://github.com/brandondahler/Data.HashFunction |
| System.IO.Abstractions | 22.1.1 | MIT | https://github.com/TestableIO/System.IO.Abstractions |
| System.Reactive | 6.1.0 | MIT | https://github.com/dotnet/reactive |
| TestableIO.System.IO.Abstractions | 22.1.1 | MIT | https://github.com/TestableIO/System.IO.Abstractions |
| TestableIO.System.IO.Abstractions.Wrappers | 22.1.1 | MIT | https://github.com/TestableIO/System.IO.Abstractions |
| Testably.Abstractions.FileSystem.Interface | 10.1.0 | MIT | https://github.com/Testably/Testably.Abstractions |
| TransparentValueObjects.Abstractions | 1.1.0 | MIT | https://github.com/erri120/TransparentValueObjects |
| ValveKeyValue | 0.13.1.398 | MIT | https://github.com/ValveResourceFormat/ValveKeyValue |
| YamlDotNet | 18.1.0 | MIT | https://github.com/aaubry/YamlDotNet |

`npm run stage:clawhub` refuses to stage a helper that ships a package this table does not name at its version.
