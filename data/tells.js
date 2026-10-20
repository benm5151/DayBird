// The tells: for each confusing group of common Upper Valley birds, the 3–6 members a newer birder will actually meet,
// the single best field mark for each, and one line splitting it from each other member of the group, in both directions.
// Hand-written by Daybird from standard field guides (Sibley, Peterson, All About Birds); NOT yet checked by an expert
// birder. Where a mark is unreliable the line says so. Species names are eBird common names and match data/traits.js
// where that file has the bird. Order inside a group is roughly "most likely first" for the Upper Valley.
//
// Shape: [{ key, title, one, intro, species: [{ name, look, vs: { <other name in this group>: <one line> } }] }]
//   key    — short id used in compare.html?g=<key> and in links from bird.html
//   title  — chip label ("Sparrows")
//   one    — the singular for the page title ("Which sparrow is that?")
//   intro  — one line on why the group is confusing
//   look   — the single best tell, one plain sentence
//   vs     — how to split this bird from each other member, one line; A.vs[B] and B.vs[A] both exist
// To add a group: append an object here with 3–6 species and write every pair both ways; `node --test tests/` checks
// that every vs key names a species in the same group, both directions exist and no line is empty.
globalThis.DAYBIRD_TELLS = [
  {
    key: 'sparrows', title: 'Sparrows', one: 'sparrow',
    intro: 'Small, brown and streaky, and they drop into the brush before the binoculars come up. Start with the head (cap, eyebrow, throat), then the chest: streaked or plain.',
    species: [
      { name: 'White-throated Sparrow',
        look: 'A yellow spot between the bill and the eye, and a white throat that really is white, like a bib cut with scissors. The crown stripes can be white or tan; both are normal.',
        vs: {
          'Song Sparrow': 'White-throated has a plain gray chest; Song\'s chest is heavily streaked with a dark spot in the middle.',
          'Dark-eyed Junco': 'White-throated is brown and striped above with a yellow spot before the eye; Junco is smooth slate gray with a white belly and a plain face.',
          'Chipping Sparrow': 'White-throated is bigger, with a bold white throat and yellow before the eye; Chipping is small and neat with a rusty cap and no white bib.',
          'White-crowned Sparrow': 'White-throated has a sharply white throat and a yellow spot before the eye; White-crowned has a plain gray throat that blends into the chest, and no yellow.',
          'House Sparrow': 'White-throated has crown stripes, a white bib and yellow by the eye, and it stays in brush; House Sparrow has a plain face (female) or a black bib (male) and stays around buildings.',
        } },
      { name: 'Song Sparrow',
        look: 'Heavy brown streaks on the chest that gather into a dark spot in the middle, and a long rounded tail it pumps in flight.',
        vs: {
          'White-throated Sparrow': 'Song is streaked down the chest with a central spot; White-throated\'s chest is plain gray and its throat is sharply white.',
          'Dark-eyed Junco': 'Song is brown and streaked below; Junco is plain gray above and white below with no streaks at all.',
          'Chipping Sparrow': 'Song is bigger with a streaked chest and a long tail; Chipping has a clean gray breast with no streaks and a rusty cap.',
          'White-crowned Sparrow': 'Song is streaky below; White-crowned has a smooth gray breast and bold black-and-white stripes on the crown.',
          'House Sparrow': 'Song has a streaked chest with a central spot; House Sparrow\'s chest is unstreaked, with a black bib on the male, and it is stockier and shorter-tailed.',
        } },
      { name: 'Dark-eyed Junco',
        look: 'Slate gray above with a clean white belly and a pink bill; the white outer tail feathers flash as it flies away.',
        vs: {
          'White-throated Sparrow': 'Junco is uniform gray with no stripes on the head; White-throated has a striped crown, a white throat and yellow in front of the eye.',
          'Song Sparrow': 'Junco is unstreaked slate gray with a white belly; Song is brown with heavy chest streaks.',
          'Chipping Sparrow': 'Junco is all gray above with a white belly; Chipping has a brown streaked back, a rusty cap and pale gray underparts.',
          'White-crowned Sparrow': 'Junco is dark gray with a plain head; White-crowned has bold black-and-white crown stripes and a brown streaked back.',
          'House Sparrow': 'Junco is slate gray with a white belly and pink bill; House Sparrow is brown and gray, the male with a black bib, and never slate gray.',
        } },
      { name: 'Chipping Sparrow',
        look: 'A rusty cap over a clean gray breast, with a sharp black line through the eye; small and neat. In fall the cap is browner and streaked, but the eyeline stays.',
        vs: {
          'White-throated Sparrow': 'Chipping is small and neat with a rusty cap and gray cheek; White-throated is bulkier with a white bib of a throat and yellow before the eye.',
          'Song Sparrow': 'Chipping\'s breast is clean gray with no streaks; Song\'s is heavily streaked with a central spot.',
          'Dark-eyed Junco': 'Chipping has a brown streaked back and a rusty cap; Junco is plain slate gray from head to back.',
          'White-crowned Sparrow': 'Chipping is smaller with a rusty cap and a white eyebrow; White-crowned has black-and-white stripes on a crown that looks puffy, and a pink or orange bill.',
          'House Sparrow': 'Chipping is slim with a rusty cap and gray breast, usually on lawns or in conifers; House Sparrow is chunky and tied to buildings, with no rusty cap.',
        } },
      { name: 'White-crowned Sparrow',
        look: 'Bold black-and-white stripes on a puffy crown, a plain gray throat and chest, and a pink or orange bill; bigger than it looks. Mostly a few weeks in October and again in May.',
        vs: {
          'White-throated Sparrow': 'White-crowned\'s throat is gray and blends into the chest; White-throated\'s is bright white, with a yellow spot in front of the eye.',
          'Song Sparrow': 'White-crowned has a smooth gray breast and a striped crown; Song is streaky below with a brown-and-gray face.',
          'Dark-eyed Junco': 'White-crowned has a brown streaked back and a striped crown; Junco is plain slate gray from head to back.',
          'Chipping Sparrow': 'White-crowned is bigger with black-and-white crown stripes; Chipping has a rusty cap and a thin black eyeline.',
          'House Sparrow': 'White-crowned has crisp black-and-white crown stripes and no bib; House Sparrow male has a plain gray crown and a black bib.',
        } },
      { name: 'House Sparrow',
        look: 'Male has a gray crown, a black bib and a chestnut stripe behind the eye; female is plain brown with a buffy eyebrow and an unstreaked chest. Both stay close to buildings.',
        vs: {
          'White-throated Sparrow': 'House Sparrow has a stout bill and stays near buildings, the male with a black bib and the female plain-faced; White-throated has crown stripes, a white throat and yellow by the eye, and is usually in brush.',
          'Song Sparrow': 'House Sparrow\'s chest is unstreaked, with a black bib on the male; Song\'s chest is streaked with a central spot.',
          'Dark-eyed Junco': 'House Sparrow is brown-backed, the male with a black bib, and never slate gray; Junco is smooth gray with a white belly and flashes white tail edges.',
          'Chipping Sparrow': 'House Sparrow is stocky and tied to buildings, with no rusty cap; Chipping is slim and rusty-capped, usually on lawns or in conifers.',
          'White-crowned Sparrow': 'House Sparrow male shows a black bib and a plain gray crown; White-crowned shows crisp black-and-white stripes and no bib.',
        } },
    ],
  },
  {
    key: 'ducks', title: 'Ducks', one: 'duck',
    intro: 'Far off on gray water every duck is a dark shape. Start with the head (shape and color), then the bill: wide and flat, or thin.',
    species: [
      { name: 'Mallard',
        look: 'Male has a glossy green head and a yellow bill; female is mottled warm brown with an orange bill marked with black, and both show a blue wing patch edged in white.',
        vs: {
          'American Black Duck': 'Female Mallard is warm brown with an orange-and-black bill; Black Duck is darker, almost sooty, with a paler head and a plain olive-yellow bill.',
          'Hooded Merganser': 'Mallard is a big dabbler with a wide flat bill and no crest; Hooded Merganser is small, with a thin bill and a crest it raises and lowers.',
          'Common Merganser': 'Mallard sits high on the water with a broad bill and tips up to feed; Common Merganser sits long and low with a thin red bill and dives.',
        } },
      { name: 'American Black Duck',
        look: 'Looks like a female Mallard but much darker, with a paler gray-brown head and a plain yellowish or olive bill; in flight the underwings flash bright white.',
        vs: {
          'Mallard': 'Black Duck\'s body is dark chocolate with a paler head and a plain bill; female Mallard is lighter brown with an orange bill marked with black.',
          'Hooded Merganser': 'Black Duck is a large, uniformly dark dabbler with a flat bill; Hooded Merganser is small and crested with a thin bill, and it dives.',
          'Common Merganser': 'Black Duck is dark brown all over with a flat bill; Common Merganser is pale-bodied (male) or gray with a rusty head (female), with a long thin red bill.',
        } },
      { name: 'Hooded Merganser',
        look: 'A small duck with a thin bill; the male has a black head with a big white fan-shaped crest, the female a shaggy cinnamon crest. Dives, and sits low on the water.',
        vs: {
          'Mallard': 'Hooded Merganser is a small slender diver with a thin bill and a crest; Mallard is big with a broad flat bill and no crest.',
          'American Black Duck': 'Hooded Merganser is small, crested and dives; Black Duck is large, uniformly dark and feeds at the surface.',
          'Common Merganser': 'Hooded Merganser is small with a dark bill and a high rounded crest; Common is much larger with a red bill, and the female\'s rusty head has a sharp white chin.',
        } },
      { name: 'Common Merganser',
        look: 'Long and low with a thin red bill; the male is mostly white with a dark green head, the female gray with a crisp rusty head and a white chin. Dives on the river all winter.',
        vs: {
          'Mallard': 'Common Merganser is long-bodied with a thin red bill and dives under; Mallard is rounder with a flat bill and tips up instead of diving.',
          'American Black Duck': 'Common Merganser has a thin red bill and a long sleek body; Black Duck is chunky and dark with a broad bill.',
          'Hooded Merganser': 'Common Merganser is big and long with a red bill; Hooded is small with a dark bill and a high rounded crest.',
        } },
    ],
  },
  {
    key: 'warblers', title: 'Warblers', one: 'warbler',
    intro: 'Quick, small and yellow somewhere, and in fall half of them lose their bright colors. Watch the tail and the rump, not just the face.',
    species: [
      { name: 'Yellow-rumped Warbler',
        look: 'A bright yellow patch on the rump, just above the tail, plus yellow on the sides; in fall it is mostly gray-brown and streaky, but the rump still shows when it flies.',
        vs: {
          'Palm Warbler': 'Yellow-rumped has yellow on the rump and sides but a whitish undertail, and forages in trees; Palm is yellow under the tail, pumps it, and is usually low or on the ground.',
          'Pine Warbler': 'Yellow-rumped has a yellow rump and a streaky chest; Pine has a yellow throat and chest with no yellow rump.',
          'Yellow Warbler': 'Yellow-rumped is gray and streaky with yellow patches; Yellow Warbler is yellow everywhere with no gray.',
        } },
      { name: 'Palm Warbler',
        look: 'Pumps its tail constantly and is often on the ground or in low weeds; yellow under the tail, with a rusty cap in spring.',
        vs: {
          'Yellow-rumped Warbler': 'Palm pumps its tail and is yellow underneath it; Yellow-rumped shows a yellow patch on the rump above the tail and forages up in trees.',
          'Pine Warbler': 'Palm pumps its tail, has a streaked chest and yellow only under the tail; Pine sits still in pines, with a clean yellow chest and white wingbars.',
          'Yellow Warbler': 'Palm is brownish with a streaky chest and yellow only under the tail; Yellow Warbler is bright yellow all over.',
        } },
      { name: 'Pine Warbler',
        look: 'A yellow throat and chest fading to a white belly, two white wingbars and a plain face; stays in pines, and it is the warbler that comes to feeders.',
        vs: {
          'Yellow-rumped Warbler': 'Pine is plain-faced with a yellow chest and an unstreaked back; Yellow-rumped has a yellow rump and streaked sides.',
          'Palm Warbler': 'Pine has bold white wingbars and a yellow chest; Palm has a streaky breast, yellow only under the tail, and pumps its tail.',
          'Yellow Warbler': 'Pine has two white wingbars and a white belly; Yellow Warbler is yellow to the belly with yellow-edged wings and no white bars.',
        } },
      { name: 'Yellow Warbler',
        look: 'Yellow all over, including under the tail, with a plain face and a beady black eye; the male has thin red streaks down the chest.',
        vs: {
          'Yellow-rumped Warbler': 'Yellow Warbler is uniformly yellow; Yellow-rumped is mostly gray with yellow only on the rump and sides.',
          'Palm Warbler': 'Yellow Warbler is unstreaked yellow, or has thin red streaks on the male; Palm is browner with a streaky chest and pumps its tail.',
          'Pine Warbler': 'Yellow Warbler is yellow from throat to undertail with no white wingbars; Pine has white wingbars and a white belly.',
        } },
    ],
  },
  {
    key: 'woodpeckers', title: 'Woodpeckers', one: 'woodpecker',
    intro: 'Black and white and clinging to a trunk. Size is hard to judge on a tree; use the bill and the pattern on the back.',
    species: [
      { name: 'Downy Woodpecker',
        look: 'A tiny bill, clearly shorter than the head is deep; a sparrow-sized woodpecker with a white stripe down the back and a few black spots on the white outer tail feathers.',
        vs: {
          'Hairy Woodpecker': 'Downy\'s bill is a stub, well under the length of the head; Hairy\'s is almost as long as the head, and the whole bird is a third bigger.',
          'Red-bellied Woodpecker': 'Downy has a solid white stripe down the back; Red-bellied\'s back is barred black and white and its cap is red.',
          'Northern Flicker': 'Downy is small, black and white; Flicker is big and brown with spots, and is often on the lawn.',
        } },
      { name: 'Hairy Woodpecker',
        look: 'The same pattern as Downy but robin-sized, with a bill nearly as long as the head and clean white outer tail feathers.',
        vs: {
          'Downy Woodpecker': 'Hairy\'s bill is long and chisel-like, nearly as long as the head; Downy\'s is a short nub, and Downy has black spots on the white outer tail.',
          'Red-bellied Woodpecker': 'Hairy has a solid white stripe down the back; Red-bellied\'s back is barred black and white with a red cap.',
          'Northern Flicker': 'Hairy is black and white; Flicker is brown and spotted with a white rump.',
        } },
      { name: 'Red-bellied Woodpecker',
        look: 'A zebra-striped black-and-white back with a red cap running down the nape; the belly is only faintly pink, so the name does not help.',
        vs: {
          'Downy Woodpecker': 'Red-bellied is bigger with a zebra back and a red nape; Downy is small with a solid white back stripe.',
          'Hairy Woodpecker': 'Red-bellied has a barred back and a red nape; Hairy\'s back has a solid white stripe, and only the male has a small red patch at the back of the head.',
          'Northern Flicker': 'Red-bellied is black-and-white above with a red cap; Flicker is brown with a spotted belly and a black bib.',
        } },
      { name: 'Northern Flicker',
        look: 'Brown with black spots and a black bib, often on the ground eating ants; a white rump flashes when it flies up.',
        vs: {
          'Downy Woodpecker': 'Flicker is brown with a black bib and white rump; Downy is small, black and white.',
          'Hairy Woodpecker': 'Flicker is brown with black spots and a black bib; Hairy is black and white with a white back stripe.',
          'Red-bellied Woodpecker': 'Flicker is brown with a spotted belly and black bib; Red-bellied is black-and-white barred above with a red cap.',
        } },
    ],
  },
  {
    key: 'hawks', title: 'Hawks', one: 'hawk',
    intro: 'A shape overhead, there and gone. Look at the tail first (length, bands, color), then at how it flies.',
    species: [
      { name: 'Red-tailed Hawk',
        look: 'Big and broad-winged with a dark belly band across a pale chest; adults have a brick-red tail, and it sits on highway poles.',
        vs: {
          'Broad-winged Hawk': 'Red-tailed is big with a belly band and a reddish tail; Broad-winged is smaller and compact with a tail boldly banded black and white.',
          'Cooper\'s Hawk': 'Red-tailed soars on broad wings with a short wide tail; Cooper\'s has a long narrow tail and flies with quick flaps between glides.',
          'Sharp-shinned Hawk': 'Red-tailed is a big soaring hawk with a belly band; Sharp-shinned is tiny and long-tailed and darts through the trees.',
        } },
      { name: 'Broad-winged Hawk',
        look: 'Smaller and compact, with a tail banded black and white in broad even bands; passes through in swirling groups in September.',
        vs: {
          'Red-tailed Hawk': 'Broad-winged is chunky and small with wide tail bands; Red-tailed is much bigger with a dark belly band on a pale chest.',
          'Cooper\'s Hawk': 'Broad-winged soars on wide wings with a short, evenly banded tail; Cooper\'s has a long tail and shorter rounded wings.',
          'Sharp-shinned Hawk': 'Broad-winged is compact with a short, boldly banded tail; Sharp-shinned is slim with a long tail and short rounded wings.',
        } },
      { name: 'Cooper\'s Hawk',
        look: 'Crow-sized, with a long tail that has a rounded, white-tipped end and a head that juts forward in flight; it ambushes feeders.',
        vs: {
          'Red-tailed Hawk': 'Cooper\'s is slimmer with a long tail and short rounded wings; Red-tailed is heavy-bodied with broad wings and a short fanned tail.',
          'Broad-winged Hawk': 'Cooper\'s is long-tailed and flies with quick flaps and glides; Broad-winged soars on wide wings with a short, evenly banded tail.',
          'Sharp-shinned Hawk': 'Cooper\'s is bigger (crow-sized) with a rounded tail tip and a big head that juts past the wings; Sharp-shinned is jay-sized with a squared tail and a small head. Hard even for experts; when unsure, call it a small hawk.',
        } },
      { name: 'Sharp-shinned Hawk',
        look: 'Jay-sized, with a long square-cut tail and a small head that barely sticks out past the wings; flap-flap-glide flight through the woods.',
        vs: {
          'Red-tailed Hawk': 'Sharp-shinned is small and long-tailed; Red-tailed is large, broad-winged and short-tailed.',
          'Broad-winged Hawk': 'Sharp-shinned has a long narrow tail and short rounded wings; Broad-winged is compact with a short tail banded black and white.',
          'Cooper\'s Hawk': 'Sharp-shinned is small with a square-tipped tail and a head that barely shows past the wings; Cooper\'s is bigger with a rounded tail and a bigger head. Size alone fools everyone.',
        } },
    ],
  },
  {
    key: 'finches', title: 'Finches', one: 'finch',
    intro: 'Streaky little feeder birds with a dash of red or yellow. Look at how heavy the streaking is and where the color sits.',
    species: [
      { name: 'American Goldfinch',
        look: 'Summer male is bright yellow with a black cap; in winter both sexes are dull olive-brown with black wings and bold white wingbars. Bounces in flight.',
        vs: {
          'House Finch': 'Goldfinch is unstreaked with black wings and white wingbars; House Finch is streaky with a blurry brown front.',
          'Purple Finch': 'Goldfinch has black wings with white bars and an unstreaked body; Purple Finch is streaked (female) or raspberry red (male).',
          'Pine Siskin': 'Goldfinch is unstreaked with black wings and clean white bars; Siskin is streaked everywhere with yellow wing edges.',
        } },
      { name: 'House Finch',
        look: 'Male has red on the forehead and chest that fades into brown streaks on the belly; female is plain gray-brown with a blurry streaked front and no face pattern.',
        vs: {
          'American Goldfinch': 'House Finch is streaky brown with red on the male; Goldfinch has black wings with white bars and no streaks at all.',
          'Purple Finch': 'House Finch male has streaky brown flanks under the red; Purple Finch male is red right down the sides with a clean white belly.',
          'Pine Siskin': 'House Finch has a stout bill and soft blurry streaks; Siskin has a thin pointed bill, sharp heavy streaks and yellow in the wings.',
        } },
      { name: 'Purple Finch',
        look: 'Male looks dipped in raspberry juice, red from the head down the back with no brown streaks on the belly; female has a bold white eyebrow and a dark cheek.',
        vs: {
          'American Goldfinch': 'Purple Finch is streaky or raspberry red; Goldfinch is plain olive or yellow with black-and-white wings.',
          'House Finch': 'Purple Finch male is raspberry red all over, including the back; House Finch male is red only on the head and chest, with a brown streaked back.',
          'Pine Siskin': 'Purple Finch female has a bold white eyebrow and a strong bill; Siskin is finely streaked with a thin bill and yellow in the wings.',
        } },
      { name: 'Pine Siskin',
        look: 'Heavily streaked all over with a thin pointed bill, and a flash of yellow in the wings and tail when it flies. Some winters there are hundreds, some none.',
        vs: {
          'American Goldfinch': 'Siskin is streaky all over; a winter Goldfinch is plain gray-brown with no streaks and bold white wingbars.',
          'House Finch': 'Siskin is sharply streaked with a thin bill and yellow wing flashes; House Finch has a stubby bill and blurry streaks, with red on the male.',
          'Purple Finch': 'Siskin shows yellow in the wings and a needle-like bill; Purple Finch is bigger-billed with a strong face pattern.',
        } },
    ],
  },
  {
    key: 'thrushes', title: 'Thrushes', one: 'thrush',
    intro: 'Brown above, spotted below, hiding in the shade. The warmth of the brown and where the spots are tell them apart.',
    species: [
      { name: 'American Robin',
        look: 'An orange-red breast on a dark gray back, standing upright on the lawn; the only thrush here with no spots as an adult.',
        vs: {
          'Hermit Thrush': 'Robin is big and orange-breasted; Hermit Thrush is small and brown with a spotted chest and a rusty tail.',
          'Wood Thrush': 'Robin has a plain orange breast; Wood Thrush has a white breast covered in big black spots.',
          'Veery': 'Robin is orange below with a dark back; Veery is warm brown with a pale, faintly smudged chest.',
        } },
      { name: 'Hermit Thrush',
        look: 'A rusty tail that is redder than the dull brown back; it raises the tail slowly and lowers it, and it is the thrush you are most likely to meet in October.',
        vs: {
          'American Robin': 'Hermit Thrush is small with a spotted breast; Robin is larger with a solid orange breast.',
          'Wood Thrush': 'Hermit\'s spots are smaller and fade out by the belly, and its tail is redder than its back; Wood Thrush is boldly spotted to the belly and rusty on the head, not the tail.',
          'Veery': 'Hermit has distinct dark spots and a rusty tail that stands out from the back; Veery is evenly warm brown with faint, smudgy spots.',
        } },
      { name: 'Wood Thrush',
        look: 'Bold round black spots covering a white chest and belly, with a rusty head and back; a flute-like song at dusk in June.',
        vs: {
          'American Robin': 'Wood Thrush is heavily spotted below with a rusty head; Robin is orange below and gray above.',
          'Hermit Thrush': 'Wood Thrush is bigger with large dark spots all the way down and a rusty head; Hermit has fewer spots and a rusty tail.',
          'Veery': 'Wood Thrush has bold black spots on a white chest; Veery has faint smudges on a buffy chest.',
        } },
      { name: 'Veery',
        look: 'Warm cinnamon brown all over with only faint, smudgy spots at the top of the chest; a spiraling, downward song on summer evenings.',
        vs: {
          'American Robin': 'Veery is cinnamon above and nearly plain below; Robin is slate above with an orange breast.',
          'Hermit Thrush': 'Veery is one warm shade of brown from head to tail with barely-there spots; Hermit has a contrasting rusty tail and clear spots.',
          'Wood Thrush': 'Veery is nearly unspotted; Wood Thrush is the most heavily spotted thrush here.',
        } },
    ],
  },
  {
    key: 'flycatchers', title: 'Flycatchers', one: 'flycatcher',
    intro: 'Gray-brown birds that sit upright and dart out for insects. Posture, tail-wagging and voice do more than color.',
    species: [
      { name: 'Eastern Phoebe',
        look: 'A dark head, no wingbars, and it pumps its tail down over and over while perched; the first flycatcher back in March and the last to leave.',
        vs: {
          'Eastern Wood-Pewee': 'Phoebe has a dark head, no wingbars and wags its tail; Pewee has two pale wingbars and sits still.',
          'Eastern Kingbird': 'Phoebe is smaller, dusky with a whitish belly and no tail band; Kingbird is black and white with a white tip on the tail.',
        } },
      { name: 'Eastern Wood-Pewee',
        look: 'Two pale wingbars, a peaked head, and it sits dead still high in the trees between sallies; the slurred "pee-a-wee" gives it away.',
        vs: {
          'Eastern Phoebe': 'Pewee has two wingbars and does not pump its tail; Phoebe has none and pumps constantly.',
          'Eastern Kingbird': 'Pewee is small and grayish with wingbars, in the woods; Kingbird is bigger, black and white, out in the open.',
        } },
      { name: 'Eastern Kingbird',
        look: 'Black above and white below with a crisp white band across the tip of the tail; sits in the open on fences and treetops and chases anything bigger.',
        vs: {
          'Eastern Phoebe': 'Kingbird is bold black-and-white with a white tail band; Phoebe is softer gray-brown and pumps its tail.',
          'Eastern Wood-Pewee': 'Kingbird is sharply black above and white below with a white-tipped tail; Pewee is gray with wingbars and no tail band.',
        } },
    ],
  },
  {
    key: 'gulls', title: 'Gulls', one: 'gull',
    intro: 'White birds in a parking lot or on the river. Bill and leg color sort the adults; the young ones are brown and take years to sort out.',
    species: [
      { name: 'Ring-billed Gull',
        look: 'A medium gull with a black ring near the tip of a yellow bill and yellowish legs; the common one in parking lots.',
        vs: {
          'Herring Gull': 'Ring-billed is smaller with a black ring on the bill and yellow legs; Herring is bigger with pink legs and a red spot on the bill.',
          'Great Black-backed Gull': 'Ring-billed is pale gray above and much smaller; Great Black-backed is huge with a black back.',
        } },
      { name: 'Herring Gull',
        look: 'A large gull with pink legs and a yellow bill with a red spot and no ring; pale gray back and wings.',
        vs: {
          'Ring-billed Gull': 'Herring has pink legs and a red spot on the bill; Ring-billed has yellow legs and a black ring on the bill.',
          'Great Black-backed Gull': 'Herring is pale gray on the back; Great Black-backed is slate-black on the back and noticeably bigger.',
        } },
      { name: 'Great Black-backed Gull',
        look: 'Huge, with a back and wings that are nearly black and pink legs; towers over the other gulls on the ice.',
        vs: {
          'Ring-billed Gull': 'Great Black-backed has a black back and dwarfs other gulls; Ring-billed is small and pale gray with a ringed bill.',
          'Herring Gull': 'Great Black-backed\'s back is black, not gray, and the bird is larger; Herring is pale gray above.',
        } },
    ],
  },
  {
    key: 'swallows', title: 'Swallows', one: 'swallow',
    intro: 'Fast, low, and gone before you focus. Tail shape and the color underneath settle most of them.',
    species: [
      { name: 'Tree Swallow',
        look: 'Glossy blue-green above and clean white below, with a short notched tail; over ponds and fields, and the first swallow back in April.',
        vs: {
          'Barn Swallow': 'Tree Swallow is white below with a short tail; Barn is orange-buff below with a long forked tail.',
          'Chimney Swift': 'Tree Swallow is white-bellied and glides; Swift is dark all over with stiff fluttery wingbeats and no tail to speak of.',
        } },
      { name: 'Barn Swallow',
        look: 'A long, deeply forked tail with streamers, a rusty throat and buffy-orange belly; swoops low over fields and under bridges.',
        vs: {
          'Tree Swallow': 'Barn has a deeply forked tail and rusty underparts; Tree is snow-white below with a short tail.',
          'Chimney Swift': 'Barn is orange below with a forked tail and swoops low; Swift is dark, looks tailless and flies high.',
        } },
      { name: 'Chimney Swift',
        look: 'A cigar with wings: dark all over, stiff curved wings, no visible tail, and a twittering flight high over town.',
        vs: {
          'Tree Swallow': 'Swift is sooty gray-brown all over; Tree Swallow is white below and blue-green above.',
          'Barn Swallow': 'Swift is uniformly dark with a cigar-shaped body and flickering wingbeats; Barn is colorful with streamers on the tail.',
        } },
    ],
  },
  {
    key: 'wrens-and-kinglets', title: 'Wrens and kinglets', one: 'wren or kinglet',
    intro: 'Tiny brown or olive birds that never stop moving in the undergrowth. Tail length and whether it flicks its wings are the first clues.',
    species: [
      { name: 'Ruby-crowned Kinglet',
        look: 'A tiny olive bird that flicks its wings every second, with a broken white eye ring and a black bar under the white wingbar; the male\'s red crown shows only when he raises it.',
        vs: {
          'Golden-crowned Kinglet': 'Ruby-crowned has a plain face with a broken white eye ring and no crown stripe unless the male flares it; Golden-crowned has a bold black-and-white striped face with the yellow crown always showing.',
          'House Wren': 'Ruby-crowned is olive with white wingbars and an eye ring; House Wren is brown with no wingbars and a longer tail.',
          'Carolina Wren': 'Ruby-crowned is olive-gray, tiny and twitchy; Carolina is rusty and buff with a strong white eyebrow.',
        } },
      { name: 'Golden-crowned Kinglet',
        look: 'Even tinier, with a striped face and a yellow-orange crown bordered in black; in loose flocks in conifers, with thin, high calls you may not hear.',
        vs: {
          'Ruby-crowned Kinglet': 'Golden-crowned always shows its yellow crown and a striped face; Ruby-crowned has a plain olive face with a white eye ring.',
          'House Wren': 'Golden-crowned has a bold striped face and yellow crown; House Wren is plain brown.',
          'Carolina Wren': 'Golden-crowned is olive and striped on the head; Carolina is rusty with one white eyebrow and a buffy belly.',
        } },
      { name: 'House Wren',
        look: 'Plain gray-brown with no eyebrow to speak of, a long cocked tail with fine bars, and a bubbling chatter from a brush pile or nest box.',
        vs: {
          'Ruby-crowned Kinglet': 'House Wren is brown with a long cocked tail; Ruby-crowned Kinglet is olive-green with wingbars and flicks its wings.',
          'Golden-crowned Kinglet': 'House Wren is brown and plain-faced; Golden-crowned Kinglet is olive with a striped face and bright crown.',
          'Carolina Wren': 'House Wren is plain brown with no eyebrow; Carolina is rusty with a bold white eyebrow and a warm buff belly.',
        } },
      { name: 'Carolina Wren',
        look: 'Rich rusty brown above with a buffy-orange belly and a bold white eyebrow; a loud "tea-kettle, tea-kettle" all year, and it stays through the winter.',
        vs: {
          'Ruby-crowned Kinglet': 'Carolina Wren is rusty with a white eyebrow and a long tail; Ruby-crowned Kinglet is tiny, olive, with wingbars and a wing flick.',
          'Golden-crowned Kinglet': 'Carolina is a warm brown wren with a white eyebrow; Golden-crowned Kinglet is olive with a striped crown.',
          'House Wren': 'Carolina has a white eyebrow and rich colors; House Wren is drab with a plain face.',
        } },
    ],
  },
  {
    key: 'blackbirds', title: 'Blackbirds', one: 'blackbird',
    intro: 'Dark birds in flocks, often all mixed together. Eye color, tail shape and the sheen of the feathers sort them.',
    species: [
      { name: 'Red-winged Blackbird',
        look: 'Male is glossy black with red shoulders edged in yellow; female is brown and heavily streaked, like a big sparrow with a pale eyebrow.',
        vs: {
          'Common Grackle': 'Red-winged has a short tail and a red shoulder (male) or heavy streaks (female); Grackle is bigger with a long keeled tail and a pale eye.',
          'Brown-headed Cowbird': 'Red-winged male shows red shoulders and the female is streaked; Cowbird male has a brown head on a black body and the female is plain gray-brown.',
          'European Starling': 'Red-winged has a longish dark bill and a rounded tail; Starling has a very short tail, a pointed bill and is speckled in fall.',
        } },
      { name: 'Common Grackle',
        look: 'A long keeled tail, a pale yellow eye, and an iridescent bronze body with a blue-purple head; walks with a swagger.',
        vs: {
          'Red-winged Blackbird': 'Grackle is long-tailed with a yellow eye and an oily sheen; Red-winged is shorter-tailed with a dark eye and a red shoulder on the male.',
          'Brown-headed Cowbird': 'Grackle is big with a long keeled tail and a yellow eye; Cowbird is small with a short tail, a dark eye and a brown head.',
          'European Starling': 'Grackle has a long tail and a pale eye; Starling has a very short tail and a dark eye.',
        } },
      { name: 'Brown-headed Cowbird',
        look: 'Male has a glossy black body with a chocolate-brown head; female is plain gray-brown all over. Both have a short, thick, finch-like bill.',
        vs: {
          'Red-winged Blackbird': 'Cowbird has a brown head (male) or is plain gray-brown (female) with a short conical bill; Red-winged has red shoulders or heavy streaks.',
          'Common Grackle': 'Cowbird is compact and short-tailed with a brown head; Grackle is long-tailed and glossy with a pale eye.',
          'European Starling': 'Cowbird has a brown head and a short thick bill; Starling has a longer pointed bill and a speckled body.',
        } },
      { name: 'European Starling',
        look: 'A short tail and a pointed bill, yellow in spring and dark in fall; speckled with white in fall and winter, glossy by spring. Flies in tight flocks on triangular wings.',
        vs: {
          'Red-winged Blackbird': 'Starling is stubby-tailed and speckled; Red-winged is sleeker with red shoulders on the male.',
          'Common Grackle': 'Starling is short-tailed, speckled, and has a yellow bill in spring; Grackle has a long tail and no speckles.',
          'Brown-headed Cowbird': 'Starling is speckled with a pointed bill and a short tail; Cowbird is unspeckled with a stubby bill and a brown head on the male.',
        } },
    ],
  },
  {
    key: 'chickadees-nuthatches-and-creeper', title: 'Chickadees, nuthatches and creeper', one: 'chickadee, nuthatch or creeper',
    intro: 'The feeder regulars that travel together in mixed flocks. Easy once you watch how each one moves on a trunk or a branch.',
    species: [
      { name: 'Black-capped Chickadee',
        look: 'A black cap and bib with white cheeks on a tiny gray bird that hangs upside down from twigs; it says its own name.',
        vs: {
          'Tufted Titmouse': 'Chickadee has a black cap and bib; Titmouse is plain gray with a crest and no bib.',
          'White-breasted Nuthatch': 'Chickadee hangs on twigs and has a black bib; Nuthatch creeps on trunks and has a white throat and chest.',
          'Red-breasted Nuthatch': 'Chickadee has a black bib and white cheeks; Red-breasted Nuthatch has a black line through the eye, a white eyebrow and a rusty belly.',
          'Brown Creeper': 'Chickadee is gray, black and white; Creeper is streaky brown and glued to the trunk.',
        } },
      { name: 'Tufted Titmouse',
        look: 'Gray with a pointed crest, a big dark eye and peach-colored flanks; a loud "peter-peter" whistle.',
        vs: {
          'Black-capped Chickadee': 'Titmouse has a crest and peach sides; Chickadee has a black cap and throat.',
          'White-breasted Nuthatch': 'Titmouse has a crest and a long tail and perches upright; Nuthatch looks tail-less, has a black cap on a white face, and clings to trunks.',
          'Red-breasted Nuthatch': 'Titmouse is bigger, crested, with a plain face; Red-breasted Nuthatch is tiny with a black eyeline and a rusty belly.',
          'Brown Creeper': 'Titmouse is smooth gray with a crest; Creeper is streaky brown and hugs the bark.',
        } },
      { name: 'White-breasted Nuthatch',
        look: 'A blue-gray back and a white face with a black cap on top, walking head-first down the trunk; a nasal "yank, yank".',
        vs: {
          'Black-capped Chickadee': 'White-breasted Nuthatch has a white face and chest and walks down trunks; Chickadee has a black bib and works the twigs.',
          'Tufted Titmouse': 'Nuthatch is stub-tailed and clings to trunks; Titmouse has a crest and sits upright on branches.',
          'Red-breasted Nuthatch': 'White-breasted is bigger with a plain white face and white belly; Red-breasted has a black line through the eye and a rusty belly.',
          'Brown Creeper': 'Nuthatch is blue-gray and walks down the trunk; Creeper is streaky brown and spirals up it.',
        } },
      { name: 'Red-breasted Nuthatch',
        look: 'A smaller nuthatch with a black line through the eye, a white eyebrow and a rusty-orange belly; a tin-horn "yank" from the conifers.',
        vs: {
          'Black-capped Chickadee': 'Red-breasted Nuthatch has a striped face and an orange belly; Chickadee has a black cap and bib with a plain white cheek.',
          'Tufted Titmouse': 'Red-breasted Nuthatch has a striped face and no crest; Titmouse has a crest and a plain gray face.',
          'White-breasted Nuthatch': 'Red-breasted has a black eyeline and orange underparts; White-breasted has a clean white face and belly.',
          'Brown Creeper': 'Red-breasted Nuthatch is blue-gray with a rusty belly and moves in every direction; Creeper is brown, streaked, and only climbs up.',
        } },
      { name: 'Brown Creeper',
        look: 'Streaky brown, the color of bark, spiraling up a trunk with its stiff tail propped against the bark, then dropping to the base of the next tree.',
        vs: {
          'Black-capped Chickadee': 'Creeper is bark-colored and climbs; Chickadee is gray with a black cap and flits on branches.',
          'Tufted Titmouse': 'Creeper is brown and climbs trunks; Titmouse is gray, crested and perches.',
          'White-breasted Nuthatch': 'Creeper goes up with a stiff tail braced on the bark; Nuthatch goes down head-first and is blue-gray and white.',
          'Red-breasted Nuthatch': 'Creeper is brown and bark-patterned; Red-breasted Nuthatch is blue-gray above with rust below and a striped face.',
        } },
    ],
  },
];
// Helpers (no DOM): the group a species belongs to, and the species record itself.
globalThis.DAYBIRD_TELLS.groupOf = function (name) { return this.find(g => g.species.some(s => s.name === name)) || null; };
globalThis.DAYBIRD_TELLS.get = function (name) { for (const g of this) { const s = g.species.find(x => x.name === name); if (s) return { ...s, group: g.key }; } return null; };
