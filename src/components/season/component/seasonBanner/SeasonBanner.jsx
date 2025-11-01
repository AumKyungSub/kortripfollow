import React from 'react'

// Page css
import './SeasonBanner.style.css'

const SeasonBanner = ({item}) => {
  return (
    <>
        <div className='seasonBannerCover'>
            <div className="seasonBannerImg">
                <img src={item?.img} alt={item?.img} />
            </div>
            <div className="seasonBannerText">
                <h3 className="seasonBannerH3">{item?.textTitle}</h3>
                <p className="seasonBannerP">{item?.text}</p>
            </div>
        </div>
    </>
        
  )
}

export default SeasonBanner
