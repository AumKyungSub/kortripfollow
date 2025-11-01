import React from 'react'

// Page css
import './SeasonCategory.style.css'

const SeasonCategory = ({selected, setSelected}) => {

  // const [selected, setSelected] = useState('봄');
  const season = ["봄", "여름", "가을", "겨울"];

  return (
    <>
      <div className='seasonCategoryCover'>
        <ul className="seasonCategoryUI">
          {season.map((sea)=>(
            <li
              key={sea}
              className={`seasonCategoryLi ${selected === sea ? 'active':''}`}
              onClick={()=>setSelected(sea)}
            >
              {sea}
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

export default SeasonCategory
